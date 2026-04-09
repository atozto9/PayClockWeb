# PayClockWeb 동기화 계획

## 목적

최근 PayClock macOS 앱에 반영된 계산/UI 변경을 PayClockWeb에도 동일한 의미로 옮긴다. 이번 문서는 구현이 아니라 작업 계획서이며, 실제 코드는 이 문서를 기준으로 별도 반영한다.

핵심 목표는 다음 4가지다.

- 기존 `발생 기준` 계산을 유지한다.
- 월 요약과 선택일 상세에 `정산 기준` 계산 모드를 추가한다.
- 정산 기준에서도 실제 심야 근무 구간이 `0시간`으로 사라지지 않게 한다.
- 월 요약 문구와 카드 구성을 현재 PayClock와 맞춘다.

## 기준 구현

PayClock 쪽 현재 구현을 기준으로 맞춘다.

- `Sources/PayClockCore/Models.swift`
- `Sources/PayClockCore/PayCalculator.swift`
- `Sources/PayClockApp/AppModel.swift`
- `Sources/PayClockApp/ContentView.swift`
- `Tests/PayClockCoreTests/PayCalculatorTests.swift`
- `Tests/PayClockAppTests/AppModelTests.swift`
- `docs/calculation-rules.md`

## 영향 파일

PayClockWeb에서는 아래 파일이 주 작업 대상이다.

- `src/domain/models.ts`
- `src/domain/payCalculator.ts`
- `src/domain/payCalculator.test.ts`
- `src/app/useAppModel.ts`
- `src/App.tsx`
- `src/App.css`
- `src/App.test.tsx`
- `docs/calculation-rules.md`

필요하면 문구 포맷 정리를 위해 `src/app/formatters.ts`도 함께 수정한다.

## 구현 범위

### 1. 도메인 모델 확장

`src/domain/models.ts`에 아래 필드를 추가한다.

- `PremiumCalculationMode = 'occurrence' | 'settlement'`
- `DayPayBreakdown.isWithinPremiumReference: boolean`
- `MonthSummary.totalNightPremiumHours: number`
- `MonthSummary.premiumCalculationMode: PremiumCalculationMode`
- `MonthSummary.premiumReferenceDayKey: string | null`

기존에 이미 있는 아래 값은 유지한다.

- `carryOverShortfallHoursForDay`
- `recommendedWorkdaysElapsed`
- `recommendedHoursToDate`

주의:

- persistence schema는 바꾸지 않는다.
- `premiumCalculationMode`는 저장 데이터가 아니라 UI 세션 상태로만 둔다.

### 2. 월 계산 API 확장

`src/domain/payCalculator.ts`의 `summarizeMonth(...)`를 모드 기반으로 확장한다.

권장 시그니처:

```ts
summarizeMonth(
  containingMonthDayKey: string,
  records: DayRecord[],
  settings: AppSettings,
  nowTimestamp = currentKoreanTimestamp(),
  mode: PremiumCalculationMode = 'occurrence',
): MonthSummary
```

구조는 다음처럼 나눈다.

- 공통 월 기본값 계산
- `occurrence` 전용 day breakdown 계산
- `settlement` 전용 day breakdown 계산

### 3. 발생 기준 유지

현재 Web 구현의 발생 기준 계산은 이미 상당 부분 맞아 있다. 다만 아래 기준을 재확인한다.

- `requiredHoursForDay`는 항상 `baseDailyRequiredHours`
- 부족분 이월은 `premiumStartHoursForDay`에만 반영
- 이전 초과근무가 있어도 이후 기준선이 기본선 아래로 내려가면 안 됨
- 주말/자동 공휴일을 `work`로 바꾼 날의 실근무는 `actualWorkedBefore`에는 포함
- 같은 날들은 유효 근무일수와 이월 분모에는 포함하지 않음
- `recommendedHoursToDate`는 현재 월은 오늘, 과거 월은 월말, 미래 월은 월 시작 전이면 `0`

### 4. 정산 기준 계산 추가

정산 기준은 `기준일까지의 월 누적 실근무를 다시 정산한 결과`를 보여주는 모드다.

기준일 규칙:

- 현재 월: 오늘
- 과거 월: 월말
- 미래 월: 없음

정산 기준 계산 절차:

1. 월 내 각 날짜를 실제 근무 구간으로 먼저 resolve 한다.
2. `premiumReferenceDayKey` 이하 날짜만 정산 대상으로 잡는다.
3. 정산 대상 날짜의 `netWorkedSeconds`를 모두 합산한다.
4. `premiumReferenceEffectiveWorkdays`를 계산한다.
5. `nonPremiumBudgetSeconds = baseDailyPremiumStartHours × 3600 × premiumReferenceEffectiveWorkdays`
6. `remainingPremiumSeconds = max(0, referencedWorkedSeconds - nonPremiumBudgetSeconds)`
7. 이 `remainingPremiumSeconds`를 실제 근무 구간의 뒤쪽부터 premium으로 배정한다.

중요:

- 배정 순서는 날짜 역순, 각 날짜 안에서는 뒤쪽 시간부터 premium이 붙는 개념으로 맞춘다.
- 따라서 과거 날짜에 찍혔던 premium이 이후 근무 누적에 따라 줄어들 수 있다.

### 5. 정산 기준 심야 가산 보존

이 부분이 이번 동기화의 핵심 추가 사항이다.

정산 기준에서 `심야 가산`을 계산할 때는 `정산 premium tail과 22시 이후 교집합`만 바로 쓰지 않는다. 그렇게 하면 실제 심야 근무가 나중의 일반 주간 premium에 밀려 `0시간`이 되는 문제가 생긴다.

PayClock 기준 규칙:

1. 먼저 정산 기준 전체 premium 시간 총량을 계산한다.
2. 각 날짜별로 실제 `22:00 이후` 근무 구간을 `night candidate`로 계산한다.
3. 정산 premium 총량을 날짜 역순으로 돌면서 `night candidate`에 먼저 배정한다.
4. 남는 premium 시간만 같은 방식으로 일반 non-night 구간에 배정한다.

즉 정산 기준에서도:

- `nightPremiumSeconds`는 실제 심야 근무가 있었던 날에 우선 귀속된다.
- `premiumOvertimeSeconds = allocatedNightSeconds + allocatedNonNightSeconds`
- `nightPremiumPay = allocatedNightSeconds × 시급 × 0.5`

이 규칙을 그대로 옮겨야 `발생 기준에는 심야가 있는데 정산 기준에는 0시간` 같은 어색한 결과가 사라진다.

### 6. 일별 breakdown 표현 정리

정산 기준용 `DayPayBreakdown`은 아래 의미를 가져야 한다.

- `isWithinPremiumReference === false`
  - 미래 월이거나
  - 현재 월에서 오늘 이후 날짜인 경우
- `premiumOvertimeSeconds === 0`
  - 정산 대상 범위 안이지만 아직 premium 미도달인 경우 가능
- `premiumStartTimestamp`
  - 정산 premium이 있는 날만 채운다
  - 계산은 `effectiveStart + nonPremiumWorkedSeconds`

발생 기준과 정산 기준 모두 `grossWorkedSeconds`, `autoBreakMinutes`, `netWorkedSeconds` 같은 근무 원본 값은 동일해야 한다.

## 상태 관리 계획

`src/app/useAppModel.ts`에서 UI 전용 상태를 추가한다.

- `premiumCalculationMode` state 추가
- 기본값은 `'occurrence'`
- 저장하지 않고 세션에서만 유지

파생 값은 분리한다.

- `monthSummary`: 기존처럼 발생 기준 유지
- `dayMap`: 기존처럼 발생 기준 유지
- `displayMonthSummary`: 현재 선택한 모드 기준 요약
- `displayDayMap` 또는 `displayBreakdownForDate`: 현재 선택한 모드 기준 상세

이렇게 분리하는 이유:

- 달력 셀 금액
- live card
- 실시간 진행 중 금액

위 세 값은 계속 발생 기준으로 두기 위해서다.

## UI 반영 계획

### 1. 월 요약 상단 토글

`src/App.tsx`의 `이번 달 요약` 영역에 아래 토글을 추가한다.

- `발생 기준`
- `정산 기준`

권장 형태는 segmented control 또는 2개 버튼 토글이다.

### 2. 총 추가 금액 카드

현재 subtitle:

- `1.5배 대상 {x}`

변경 후:

- `1.5배 대상 {x} · 심야 가산 {y}`

주의:

- 시간은 합산식으로 쓰지 않는다.
- `심야 가산`은 `1.5배 대상`의 부분집합이므로 `= ... + ...` 표기는 피한다.

### 3. 총 실근무 카드

현재처럼 `실근무 / 권장근무` 형식을 유지하되, 정산 모드와 무관하게 권장근무 로직은 동일하게 쓴다.

표시 예:

- `42.0시간 / 48.0시간`
- `실근무 / 기준일까지 권장근무 · 유효 근무일 n일`

### 4. 1.5배 시작선 카드

발생 기준:

- 현재 Web 표현 유지
- `필수 + 추가 기준 분배 + 이월` subtitle 유지

정산 기준:

- 비근무일이면 `적용 안 함`
- 기준일 이후 날짜면 `정산 대상 아님`
- 정산 premium이 없으면 `미도달`
- 정산 premium이 있으면 그날 실제 premium 시작 시점까지의 시간을 표시
- subtitle은 `정산 기준 · 기준일까지 누적 실근무로 재계산`

### 5. 선택한 날짜 영역

선택일 카드/지표도 현재 모드 기준으로 바꾼다.

- `추가 금액`
- `심야 가산`
- `추가수당 시작`

정산 기준에서 `추가수당 시작` 문구 규칙:

- 비근무 또는 기준일 이후면 `정산 대상 아님`
- 정산 대상이지만 premium이 없으면 `미도달`
- 근무 시작이 없으면 `시작시간 입력 필요`
- 그 외에는 정산 premium 시작 시각 표시

### 6. 스타일 조정

`src/App.css`에서 아래를 같이 손본다.

- 긴 숫자 subtitle 줄바꿈 허용
- 요약 카드와 토글의 좁은 화면 대응
- 새 토글 UI 스타일

## 테스트 계획

### 1. 계산 테스트

`src/domain/payCalculator.test.ts`에 아래 시나리오를 추가한다.

- 발생 기준 부족분 이월이 `requiredHoursForDay`가 아니라 `premiumStartHoursForDay`에만 반영된다.
- 이전 초과근무가 있어도 기준선이 기본선 아래로 내려가지 않는다.
- 미래 연차/출장/휴무/수동 공휴일 변경 시 같은 달 과거 날짜 기준선이 다시 계산된다.
- 주말/자동 공휴일 근무는 누적 실근무에는 포함되지만 유효 근무일수 분모에는 포함되지 않는다.
- 유효 근무일 수가 `0`이면 required/premium/recommended가 모두 `0`이다.
- 현재 월/과거 월/미래 월의 권장근무시간이 각각 맞게 계산된다.
- 정산 기준에서 월초 하루 초과근무 후 나머지를 필수만 채우면 과거 premium이 줄어든다.
- 정산 기준 총 premium 시간이 `max(0, referencedWorked - nonPremiumBudget)`와 일치한다.
- 정산 기준에서도 실제 심야 근무가 있으면 `nightPremiumSeconds`가 `0`으로 사라지지 않는다.
- 정산 기준에서 `nightPremiumEnabled`가 꺼진 날은 심야 가산이 없다.
- 미래 월 또는 오늘 이후 날짜는 `isWithinPremiumReference === false` 처리된다.

### 2. UI 테스트

`src/App.test.tsx`에 아래를 추가한다.

- 기본 모드가 `발생 기준`인지 확인
- 토글 전환 시 요약 카드 값이 바뀌는지 확인
- `총 추가 금액` subtitle이 `1.5배 대상 ... · 심야 가산 ...` 형식인지 확인
- 정산 기준에서 `1.5배 시작선` 카드가 `정산 대상 아님`, `미도달` 상태를 올바르게 보여주는지 확인
- live card와 달력 금액은 토글과 무관하게 발생 기준을 유지하는지 확인
- 모드 상태가 localStorage 데이터에 저장되지 않는지 확인

필요하면 `useAppModel` 전용 테스트를 별도 추가해도 된다. 다만 현재 구조라면 `App.test.tsx`로 충분할 가능성이 높다.

## 문서 반영 계획

구현 후 `PayClockWeb/docs/calculation-rules.md`를 현재 PayClock 문서와 같은 의미로 갱신한다.

반드시 포함할 내용:

- `발생 기준 / 정산 기준` 두 모드 설명
- 정산 기준의 기준일 규칙
- 정산 기준에서 실제 심야 근무를 먼저 보존하는 규칙
- 토글 영향 범위는 월 요약과 선택일 상세에만 한정된다는 점
- live card와 달력은 계속 발생 기준이라는 점

## 구현 순서 권장안

1. `models.ts`에 타입 확장
2. `payCalculator.ts`에 `occurrence / settlement` 분리
3. `payCalculator.test.ts`로 계산 회귀 먼저 고정
4. `useAppModel.ts`에 모드 상태와 파생 summary 추가
5. `App.tsx`에 토글 및 카드 문구 반영
6. `App.css`로 토글/줄바꿈 정리
7. `App.test.tsx`로 화면 회귀 보강
8. `docs/calculation-rules.md` 갱신

## 검증 명령

구현 후 최소 아래 명령을 실행한다.

- `npm test`
- `npm run build`

선택:

- `npm run lint`
- `npm run test:e2e`

## 구현 시 고정할 결정

아래 항목은 임의 변경 없이 유지하는 것을 권장한다.

- 토글 라벨은 `발생 기준`, `정산 기준`
- 기본 진입 모드는 `발생 기준`
- 토글 상태는 세션 전용이며 persistence에 저장하지 않음
- 달력 셀, live card, 진행 중 실시간 금액은 계속 발생 기준 사용
- 정산 기준의 심야 가산은 실제 `22:00 이후` 근무 구간을 먼저 premium으로 보존
- `총 추가 금액` 카드의 시간 subtitle은 `1.5배 대상 ... · 심야 가산 ...` 형식 유지
