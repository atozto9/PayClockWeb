# PayClock Web

PayClock의 웹/PWA 버전입니다. Windows 포함 브라우저에서 실행할 수 있고, 모든 데이터는 기본적으로 브라우저 로컬 저장소에만 저장됩니다.

## 특징

- macOS 앱과 같은 계산 규칙
- 필수 근무시간 부족분만 남은 유효 근무일에 재분배
- 추가 기준 시간은 월 전체 유효 근무일수 기준으로 고정 분배
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

## 문서

- 계산 규칙: [docs/calculation-rules.md](docs/calculation-rules.md)

## 배포

정적 파일만 생성하므로 GitHub Pages 같은 정적 호스팅에 그대로 올릴 수 있습니다.

`BASE_URL` 환경 변수를 주면 배포 경로를 바꿀 수 있고, GitHub Actions에서는 저장소 이름을 기준으로 기본 경로를 자동 계산합니다.

### GitHub Pages

이 저장소에는 `main` 브랜치 push 시 자동으로 GitHub Pages에 배포하는 workflow가 포함되어 있습니다.

1. GitHub 저장소의 `Settings > Pages`로 이동합니다.
2. `Build and deployment`의 `Source`를 `GitHub Actions`로 선택합니다.
3. `main` 브랜치에 push 하면 Actions가 `dist/`를 빌드해서 Pages에 배포합니다.
4. 배포된 URL을 Windows의 Edge에서 열고 `앱 설치`를 하면 PWA처럼 사용할 수 있습니다.

주의:
- 배포 후 데이터는 서버가 아니라 사용 중인 브라우저의 로컬 저장소에 남습니다.
- `localhost`에서 쓰던 데이터는 배포 URL로 자동 이전되지 않으므로 필요하면 JSON/CSV 내보내기 후 다시 불러오면 됩니다.

## 저장

- 기본 키: `payclock:data:v1`
- 백업 키: `payclock:data:backup:v1`
- 불러오기 시 JSON은 전체 덮어쓰기, CSV는 날짜 기준 병합
