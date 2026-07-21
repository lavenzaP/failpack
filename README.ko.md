# Failpack

[![CI](https://github.com/lavenzaP/failpack/actions/workflows/ci.yml/badge.svg)](https://github.com/lavenzaP/failpack/actions/workflows/ci.yml)
[![Node 20+](https://img.shields.io/badge/node-20%2B-3c873a)](https://nodejs.org/)
[English README](README.md)

**실패한 명령 한 번을 다른 사람이 재현할 수 있는 버그 리포트로 바꿉니다.**

```powershell
npx --yes github:lavenzaP/failpack -- npm test
```

Failpack은 지정한 명령을 실행하면서 출력을 평소처럼 터미널에 보여주고, 정확한 재현 명령·종료 코드·최근 출력·OS와 관련 런타임·프로젝트 표시 파일·Git 상태가 담긴 Markdown 리포트를 만듭니다. 저장 전에 민감한 값을 마스킹하며, 원래 명령의 종료 코드를 그대로 반환하므로 CI의 실패도 숨기지 않습니다.

![실패한 명령을 마스킹된 리포트로 바꾸는 Failpack](docs/demo.svg)

[실제로 생성된 리포트 보기](docs/sample-report.md)

## 만든 이유

GitHub 공식 버그 리포트 예시도 재현 단계, 실행 환경, 관련 로그를 요구합니다. 하지만 실제로는 누군가 “제 컴퓨터에서는 되는데요”라고 말한 뒤에야 이 정보를 다시 모으는 경우가 많습니다. [Failpack은 실패가 발생한 실행에서 바로 필요한 정보를 수집합니다](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms#converting-a-markdown-issue-template-to-a-yaml-issue-form-template).

[`envinfo`](https://github.com/tabrindle/envinfo) 같은 도구는 개발 환경 정보를 모읍니다. Failpack은 그 옆의 빈 부분을 다룹니다. 실제 실패 명령을 실행하고, 종료 동작을 유지하고, 작은 Git 스냅샷을 붙이고, 외부에 공유하기 전에 리포트를 마스킹합니다.

## 설치

GitHub에서 바로 실행:

```powershell
npx --yes github:lavenzaP/failpack -- npm test
```

저장소를 복제해 설치:

```powershell
git clone https://github.com/lavenzaP/failpack.git
cd failpack
npm install -g .
failpack -- npm test
```

Node.js 20 이상이 필요하며 런타임 의존성은 없습니다.

## 사용법

`--` 뒤에 수집할 명령을 그대로 적습니다.

```powershell
failpack -- pytest -q
failpack -- dotnet test
failpack -- cargo test
failpack --output issue.md -- npm run build
failpack --max-output 1024 -- pnpm test
failpack --no-git -- node reproduce.js
```

```text
옵션:
  -o, --output <file>   리포트 경로(기본값: 현재 폴더의 타임스탬프 파일)
      --max-output <KB> stdout과 stderr에서 보존할 마지막 용량(기본값: 512)
      --no-git          브랜치, 커밋, 상태, diff 요약 수집 생략
  -h, --help            도움말 표시
  -v, --version         버전 표시
```

출력이 매우 크면 마지막 부분을 보존합니다. 실패 원인과 스택 트레이스가 보통 끝부분에 있기 때문이며, 잘린 출력은 리포트에 명확히 표시합니다.

## 리포트에 포함되는 정보

| 수집함 | 의도적으로 수집하지 않음 |
| --- | --- |
| 정확한 명령과 인자 | 환경변수 값 |
| 종료 코드, 신호, 실행 시간 | 소스 파일 내용 |
| stdout과 stderr 마지막 부분 | 호스트 이름과 IP 주소 |
| OS, 아키텍처, 관련 도구 버전 | Git 원격 주소 |
| 확인된 manifest와 lockfile | 전체 Git diff |
| 브랜치, 커밋, 상태, diff 요약 | 자동 업로드와 분석 추적 |

런타임은 현재 폴더의 파일에 맞춰 확인합니다. 예를 들어 `pyproject.toml`, `requirements.txt`, `Pipfile`, `uv.lock` 중 하나가 있을 때만 Python 버전을 조회합니다.

## 마스킹

리포트를 저장하기 전에 다음 값을 치환합니다.

- Windows, macOS, Linux 사용자 홈 경로
- 이메일 주소
- Bearer 토큰과 JWT
- GitHub, AWS, OpenAI 형태의 키
- 계정 정보가 들어 있는 URL
- 이름이 `token`, `password`, `secret`, `api_key` 등으로 끝나는 값 할당

명령의 원본 출력은 자신의 터미널에 그대로 표시됩니다. 저장되는 리포트만 마스킹합니다. 패턴 검사만으로 프로젝트 고유 식별자를 모두 알 수는 없으므로 공개하기 전에 리포트를 한 번 확인해야 합니다.

## Failure ID

각 리포트에는 마스킹된 명령, 종료 코드, 출력으로 계산한 12자리 식별자가 들어갑니다. 타임스탬프, 메모리 주소, 실행 시간은 정규화하므로 같은 실패가 반복됐는지 업로드 없이 비교할 수 있습니다.

## 범위

Failpack은 버그 원인을 진단하거나 소스 코드를 읽거나 최소 재현 프로젝트를 자동 생성하지 않습니다. 첫 지원 요청에 필요한 정보를 빠짐없이 안전하게 넘기는 데 집중하며, 실패의 의미는 사람이 판단합니다.

## 개발 및 검증

```powershell
npm run check
npm test
npm run pack:check
node bin/failpack.js -- node examples/demo-failure.js
```

인자 처리, 출력 제한, 프로젝트 감지, Markdown 안전성, 비밀값 마스킹, 명령 실행, 종료 코드 유지, 전체 CLI 리포트 흐름을 테스트합니다. GitHub Actions에서는 Windows, macOS, Linux를 모두 확인합니다.

## 라이선스

MIT
