# parallel-work

겹치지 않는 다음 GitHub 이슈를 골라 병렬 Claude Code 세션을 시작하는 플러그인.

Claude Code 는 이미 `claude --worktree <이름>` 으로 워크트리를 만들고 그 안에서
세션을 띄운다. 파일 격리는 그것으로 끝난다. 남는 문제는 그 위에 있다 —
**무엇을 가져갈 것인가.** 세션을 서너 개 굴리다 보면 "지금 뭐가 돌고 있더라"를
사람이 기억해야 하고, 결국 두 세션이 같은 파일을 만지거나 이미 하고 있는 일을
또 집는다.

이 플러그인은 그 판단을 담당한다. 워크트리는 직접 만들지 않는다 —
`claude --worktree` 가 이미 한다.

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
설정(`.github/labeler.yaml`)이 있으면 그대로 읽는다. PR 라벨과 같은 규칙을 써야
"라벨이 말하는 영역"과 "겹침 판정이 말하는 영역"이 갈라지지 않는다.

### actions/labeler 를 쓰지 않는 저장소

**필수가 아니다.** `.github/labeler.yaml` 이 없으면 최상위 디렉터리를 영역으로
삼는다 — `frontend/`, `backend/` 가 있으면 그게 영역이 된다. 그 사실은 경고로
알린다.

이슈 쪽은 라벨 이름으로 맞춘다. 이때 **글자와 숫자만 남기고 소문자로 만들어**
비교하므로, 라벨이 `🖥️frontend` 든 `Front-End` 든 디렉터리 `frontend` 와 이어진다.
그래서 라벨 이름을 디렉터리 이름에 맞춰 붙이기만 하면 labeler 없이도 겹침 판정이
그대로 돈다.

이슈에 영역과 이어지는 라벨이 하나도 없으면 그 이슈는 `영역 라벨 없음 — 겹침
판정 불가` 로 표시된다. 순위에서 빠지지는 않지만, 겹치는지 아닌지는 사람이
판단해야 한다.

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

## 모드

`mode` 가 `"team"`(기본) 또는 `"solo"` 다. 조사 결과 첫 줄에 어느 모드인지 찍힌다.

| | team | solo |
| --- | --- | --- |
| draft PR 먼저 열라고 안내 | 한다 | 하지 않는다 |
| 남이 담당인 이슈 | 후보에서 뺀다 | 해당 없음 |

`team` 이 기본이다. 잘못 골랐을 때 team 쪽이 안전하다 — 확인이 하나 더 붙을
뿐이지만, 반대로 팀에서 solo 로 돌면 남의 작업을 덮어쓸 수 있다. `mode` 에
`team`/`solo` 가 아닌 값이 들어 있으면 경고하고 team 으로 본다.

**선점과 Status 관리는 모드에 딸리지 않는다.** 혼자 쓴다고 생략하지 않는다 —
이 도구를 쓰는 상황 자체가 세션을 여럿 굴리는 상황이고, 그러면 행위자도 여럿이다.
담당자만으로는 "잡아만 둔 것"과 "지금 붙어 있는 것"을 가르지 못하므로 Status 가
필요하고, 선점 후 되읽기도 두 모드 모두 한다. 끄고 싶으면 `claimStatus` 를
`null` 로 명시하라.

## 새 세션을 여는 방식

`launch` 가 고른다.

| | 하는 일 |
| --- | --- |
| `print` (기본) | 붙여넣을 명령 한 줄을 출력한다 |
| `session` | 새 창을 열어 그 안에서 세션을 바로 시작한다 |

`print` 가 기본인 이유는 어느 터미널·어느 OS 에서든 확실히 동작하고, 띄우기 전에
선택을 한 번 볼 수 있어서다.

`session` 은 중간에 셸 스크립트를 하나 만들고 터미널에게 그것을 실행시킨다.
명령을 터미널 인자로 직접 넘기면 OS 마다 다른 따옴표 규칙에 걸려 조용히 깨진다.

| OS | 여는 방법 |
| --- | --- |
| Windows | Windows Terminal(`wt`) 이 있으면 새 탭, 없으면 새 `cmd` 창 |
| macOS | `open -a Terminal` |
| Linux | `x-terminal-emulator` / `gnome-terminal` / `konsole` / `xterm` 중 있는 것 |

맞는 게 없으면 `terminalCommand` 로 직접 지정한다. `{script}` 가 실행할 파일로,
`{dir}` 가 저장소 루트로 바뀐다.

```json
"terminalCommand": ["wezterm", "start", "--cwd", "{dir}", "--", "{script}"]
```

창을 여는 데 실패하면 붙여넣을 명령을 대신 내놓는다. 막다른 길이 되지는 않는다.

## 설정

저장소 루트에 `.claude/parallel-work.json` 을 두면 기본값을 덮어쓴다. 없어도
동작한다.

```json
{
    "mode": "team",
    "projectNumber": 1,
    "priorityField": "Priority",
    "priorityOrder": ["P0", "P1", "P2"],
    "statusField": "Status",
    "statusOrder": ["Todo", "", "Backlog"],
    "excludeStatuses": ["In Progress", "Done"],
    "labelOrder": ["bug", "enhancement"],
    "areaSource": ".github/labeler.yaml",
    "claimStatus": "In Progress",
    "launch": "print",
    "setup": {
        "frontend": "npm install --prefix frontend",
        "ai": "pip install -r ai/requirements.txt"
    }
}
```

| 키 | 뜻 |
| --- | --- |
| `mode` | `"team"`(기본) 또는 `"solo"`. 위 표를 보라 |
| `projectNumber` | GitHub Project 번호. 생략하면 소유자의 Project 가 정확히 하나일 때만 자동으로 찾는다 |
| `priorityField` / `statusField` | Project 의 필드 이름 |
| `priorityOrder` / `statusOrder` | 앞에 있을수록 먼저. `""` 는 값이 비어 있는 이슈 |
| `excludeStatuses` | 이 Status 인 이슈는 후보에서 제외 |
| `areaSource` | 경로 → 영역 매핑을 읽을 파일 |
| `claimStatus` | 선점할 때 옮길 Status. `null` 이면 옮기지 않는다 |
| `launch` | `"print"`(기본) 또는 `"session"`. 위 표를 보라 |
| `terminalCommand` | `session` 에서 창을 여는 명령을 직접 지정 |
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

Windows, macOS, Linux 에서 똑같이 동작한다. 절대 경로를 박아두지 않고, 창을 여는
방법은 OS 별로 갈라 처리한다.

GitHub Project 는 없어도 된다. 없으면 Priority·Status 없이 겹침·라벨·이슈 번호
로만 순위를 매기고, 그 사실을 경고로 알린다.

## 여러 명이 쓸 때

혼자 세션을 여럿 띄우든 팀으로 나눠 쓰든 똑같이 동작한다.

- **선점 경합.** GitHub 에는 이슈를 원자적으로 잠그는 수단이 없다. 같은 순간에
  둘이 집으면 둘 다 담당자로 올라간다. `claim.mjs` 는 담당자를 건 뒤 **되읽어**
  다른 사람이 함께 올라와 있는지 본다. 그렇다면 0 이 아닌 값으로 끝나고, 늦게
  온 쪽이 물러난다. 이 되읽기가 락을 대신한다.
- **내 담당과 남의 담당.** 남이 담당인 이슈는 후보에서 뺀다. 내가 담당인 이슈는
  빼지 않고 `이미 내가 선점함 — 이어받기` 로 표시해 **순위 맨 앞**에 올린다.
  지난번에 걸어두고 아직 시작하지 않은 것을 먼저 끝내라는 뜻이다.
- **남의 진행 중 작업.** 열린 PR 의 변경 파일에서 영역을 뽑아 점유에 반영한다.
  작성자와 draft 여부도 함께 보여준다.

### 하나 남는 한계

**남의 로컬 워크트리는 볼 수 없다.** `git worktree list` 는 내 머신만 안다.
아직 PR 을 열지 않은 남의 작업은 이 도구에 보이지 않는다.

이건 도구로 메울 수 없고 팀 규칙으로 메워야 한다 — **작업을 시작하면서 draft PR
을 먼저 여는 것.** 그러면 그 순간부터 변경 파일이 점유 영역에 잡힌다. 선점
단계에서 Status 를 `In Progress` 로 옮기는 것도 같은 구멍을 좁힌다.

## 라이선스

MIT
