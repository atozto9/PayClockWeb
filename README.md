# PayClock Web

PayClock의 웹/PWA 버전입니다. Windows 포함 브라우저에서 실행할 수 있고, 모든 데이터는 기본적으로 브라우저 로컬 저장소에만 저장됩니다.

## 특징

- macOS 앱과 같은 계산 규칙
- 한국 시간 기준 달력/진행 중 계산
- 기본 시급 `10,000원`
- JSON/CSV import-export 호환
- PWA 설치 지원
- 백업 키를 포함한 로컬 저장 복구

## 실행

```bash
npm install
npm run dev
```

## 검증

```bash
npm test
npm run build
npm run test:e2e
```

## 배포

정적 파일만 생성하므로 GitHub Pages 같은 정적 호스팅에 그대로 올릴 수 있습니다.

`BASE_URL` 환경 변수를 주면 배포 경로를 바꿀 수 있고, GitHub Actions에서는 저장소 이름을 기준으로 기본 경로를 자동 계산합니다.

## 저장

- 기본 키: `payclock:data:v1`
- 백업 키: `payclock:data:backup:v1`
- 불러오기 시 JSON은 전체 덮어쓰기, CSV는 날짜 기준 병합
