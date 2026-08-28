# parallel-work

겹치지 않는 다음 GitHub 이슈를 골라 병렬 Claude Code 세션을 시작하는 플러그인.

Claude Code 는 이미 `claude --worktree <이름>` 으로 워크트리를 만들고 그 안에서
세션을 띄운다. 파일 격리는 그것으로 끝난다. 남는 문제는 그 위에 있다 —
**무엇을 가져갈 것인가.** 세션을 서너 개 굴리다 보면 "지금 뭐가 돌고 있더라"를
사람이 기억해야 하고, 결국 두 세션이 같은 파일을 만지거나 이미 하고 있는 일을
또 집는다.

이 플러그인은 그 판단만 담당한다. 워크트리를 만들지도, 세션을 띄우지도 않는다.

## 설치

```bash
claude plugin marketplace add do0ori/claude-parallel-work
claude plugin install parallel-work@do0ori
```

## 쓰는 법

주 체크아웃에서:

```
/next-task
```

진행 중인 워크트리를 조사해 겹치지 않는 이슈를 고르고, 담당자로 자신을 걸고,
붙여넣을 명령을 준다.

```
선택: #29 SplashScreen 이 SafeAreaProvider 바깥에서 렌더된다
  근거: P1 · bug · frontend
  겹침: 없음
  선점: assignee=do0ori ✓

새 터미널에 붙여넣으세요:
  claude --worktree frontend/splash-safe-area "/work-issue 29"
```

새 터미널에서 그 명령을 실행하면 워크트리가 생기고, 그 세션이 `/work-issue 29`
로 브랜치 이름을 정돈하고 환경을 갖춘 뒤 이슈를 읽고 착수한다.

`/next-task --dry-run` 은 순위와 근거만 보여주고 선점하지 않는다.

## 어떻게 겹침을 판단하나

**영역**(area)이라는 하나의 개념으로 판단한다. 영역은 저장소를 나누는 큰
덩어리다 — `frontend`, `backend`, `ai` 같은 것.

- **이슈의 영역**은 그 이슈에 붙은 라벨에서 온다.
- **워크트리의 영역**은 그 워크트리가 실제로 건드린 파일에서 온다. 아직
  아무것도 안 바꿨으면 브랜치 이름으로 추정한다.
- 후보 이슈의 영역이 진행 중인 워크트리의 영역과 겹치면 순위를 내린다.

경로 → 영역 매핑은 저장소의 [`actions/labeler`](https://github.com/actions/labeler)
설정(`.github/labeler.yaml`)을 그대로 읽는다. PR 라벨과 같은 규칙을 써야 "라벨이
말하는 영역"과 "겹침 판정이 말하는 영역"이 갈라지지 않는다. 그 파일이 없으면
최상위 디렉터리를 영역으로 삼는다.

**겹침은 제외가 아니라 감점이다.** 겹치는 후보밖에 없으면 임의로 고르지 않고
사람에게 묻는다.

하드 제외는 따로 있다 — 담당자가 있거나, Project Status 가 제외 목록에 있거나,
진행 중인 워크트리·PR 이 그 이슈를 참조하는 경우.

## 순위

| 순위 | 기준 |
| --- | --- |
| 1 | Priority — 설정한 순서대로, 미설정은 맨 뒤 |
| 2 | 겹침 — 겹치면 뒤로 |
| 3 | Status — 설정한 순서대로 |
| 4 | 라벨 — `bug` > `enhancement` > 그 외 |
| 5 | 이슈 번호 — 오래된 것 먼저 |

## 설정

저장소 루트에 `.claude/parallel-work.json` 을 두면 기본값을 덮어쓴다. 없어도
동작한다.

```json
{
    "projectNumber": 1,
    "priorityField": "Priority",
    "priorityOrder": ["P0", "P1", "P2"],
    "statusField": "Status",
    "statusOrder": ["Todo", "", "Backlog"],
    "excludeStatuses": ["In Progress", "Done"],
    "labelOrder": ["bug", "enhancement"],
    "areaSource": ".github/labeler.yaml",
    "setup": {
        "frontend": "npm install --prefix frontend",
        "ai": "pip install -r ai/requirements.txt"
    }
}
```

| 키 | 뜻 |
| --- | --- |
| `projectNumber` | GitHub Project 번호. 생략하면 소유자의 Project 가 정확히 하나일 때만 자동으로 찾는다 |
| `priorityField` / `statusField` | Project 의 필드 이름 |
| `priorityOrder` / `statusOrder` | 앞에 있을수록 먼저. `""` 는 값이 비어 있는 이슈 |
| `excludeStatuses` | 이 Status 인 이슈는 후보에서 제외 |
| `areaSource` | 경로 → 영역 매핑을 읽을 파일 |
| `setup` | 영역별 환경 준비 명령. `/work-issue` 가 **건드릴 영역의 것만** 실행한다 |

`statusOrder` 의 `""` 는 Project 에 올라 있지 않거나 Status 가 비어 있는 이슈를
뜻한다. 위 예시는 "Todo 가 먼저, 그다음 미분류, Backlog 는 맨 뒤"로 읽는다.

### 새 워크트리에 설정 파일 딸려 보내기

워크트리는 새 체크아웃이라 gitignore 된 `.env` 류가 없다. 저장소 루트에
`.worktreeinclude` 를 두면 Claude Code 가 워크트리를 만들 때 복사한다.

```
frontend/.env
proxy/.env
```

## 요구사항

`git`, 인증된 `gh`, Node 18 이상. 조사 스크립트는 외부 패키지를 쓰지 않는다 —
`node_modules` 가 없는 새 워크트리에서도 돌아야 하기 때문이다.

Windows 와 macOS 에서 똑같이 동작한다. 터미널을 여는 방법은 OS 마다 다르므로
(`wt`, `open`, tmux…) 세션을 대신 띄우지 않고 명령만 출력하는 것도 그래서다.

## 여러 명이 쓸 때

이 플러그인은 **한 사람이 세션을 여럿 띄우는 상황**을 전제로 만들었다. 팀에서
쓰려면 아래를 더해야 한다.

- **선점 경합 확인.** 지금은 `gh issue edit --add-assignee @me` 만 한다.
  사람이 여럿이면 선점 직후 `gh issue view --json assignees` 로 되읽어, 담당자가
  내가 아니면 다음 후보로 넘어가는 단계가 필요하다.
- **남의 담당 구분.** 지금은 담당자가 있는 이슈를 전부 똑같이 제외한다.
  "내가 담당인데 아직 시작 안 한 것"은 이어받아야 하고 "남이 담당인 것"은
  건드리면 안 되는데, 이 둘을 구분하지 않는다.
- **남의 워크트리는 안 보인다.** 겹침 판정은 `git worktree list`, 즉 **내
  머신의 워크트리**만 본다. 남의 진행 중 작업은 열린 PR 로만 보인다. PR 을
  일찍(draft 로) 여는 규칙을 함께 두거나, 원격 브랜치도 조사해야 한다.
- **Project Status 자동 갱신.** 선점할 때 `In Progress` 로, 머지 뒤 `Done` 으로
  옮기는 것. 지금은 손으로 옮긴 값을 읽기만 한다.

## 라이선스

MIT
