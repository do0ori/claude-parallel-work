---
name: picking-parallel-work
description: Picks the next GitHub issue that does not collide with work already running in another git worktree, claims it, and starts a new parallel Claude session on it. Also sets up or adjusts its own configuration for a repository. Use whenever someone asks what to work on next, asks to pick up or start another task, asks for something that will not overlap with work already running, asks to spin up another session or worktree to work in parallel, hands a specific issue number to a fresh session to begin, or asks to configure/tune how work gets picked (priority order, which GitHub Project, per-area setup commands, whether new sessions open a window). Triggers in English include "what's next", "next task", "pick up another issue", "start another session in parallel", "give me something that won't conflict", "set up parallel work". Korean triggers include "다음 작업", "다음에 뭐 할까", "겹치지 않는 작업 가져와", "작업 하나 더 시작", "새 세션 띄워서 작업", "병렬로 하나 더", "이슈 하나 잡아서 시작해줘", "병렬 작업 설정해줘". Respond in the language the person used. Do not wait for the /next-task or /work-issue commands — those are shortcuts into this same skill.
---

# 병렬 작업 고르기

여러 Claude 세션을 워크트리마다 하나씩 띄워 병렬로 굴릴 때, "지금 뭐가 돌고
있더라"를 사람이 기억해서 겹치지 않는 일감을 고르는 건 오래 못 간다. 이 스킬은
그 판단을 규칙으로 고정한다.

두 갈래로 쓰인다.

- **고르기** (`/next-task`): 진행 중인 작업을 조사해 겹치지 않는 이슈를 고르고,
  선점한 뒤, 새 세션을 띄울 명령을 출력한다.
- **착수** (`/work-issue <번호>`): 새로 뜬 세션이 워크트리를 정돈하고 그 이슈에
  달라붙는다.

혼자 세션을 여럿 띄우든 팀으로 나눠 쓰든 동작은 같다. 모드가 없다.

혼자라고 선점이나 Status 를 생략하지 않는다. 이 도구를 쓰는 상황 자체가 세션을
여럿 굴리는 상황이고, 그러면 혼자여도 행위자는 여럿이다. 담당자만으로는
"잡아만 둔 것"과 "지금 붙어 있는 것"을 가르지 못하므로 Status 도 함께 옮긴다.

**사람이 쓴 언어로 답하라.** 이 문서가 한국어인 것은 규칙이 아니다.

## 설정하기

**설정 없이 먼저 써 보게 하라.** `.claude/parallel-work.json` 은 없어도 된다.
Project 가 하나뿐이면 알아서 찾고, 영역은 `.github/labeler.yaml` 이나 최상위
디렉터리에서 읽고, 나머지는 기본값으로 돈다. 설정부터 만들자고 먼저 권하지 마라.

설정이 필요해지는 경우는 정해져 있다.

| 증상 | 채울 것 |
| --- | --- |
| "Project 가 N 개라 정하지 못했다" 경고 | `projectNumber` |
| Priority·Status 값 이름이 다른 저장소 | `priorityField` / `statusField` / `priorityOrder` / `statusOrder` / `excludeStatuses` |
| 새 워크트리에서 빌드가 설치물 없이 실패 | `setup` |
| 새 세션을 창까지 열어 시작하고 싶다 | `launch: "session"` |

**사람에게 값을 묻지 마라. 저장소를 읽고 제안한 뒤 확인만 받아라.**

```
gh project list --owner <소유자> --format json
gh project field-list <번호> --owner <소유자> --format json
```

`setup` 은 저장소를 보고 채운다 — 영역 디렉터리에 `package.json` 이 있으면
`npm install --prefix <영역>`, `requirements.txt` 가 있으면
`pip install -r <영역>/requirements.txt`, gradle 이면 첫 빌드가 알아서 받으므로
비워 둔다.

없는 파일을 만들 때는 필요한 키만 적어라. 기본값과 같은 값을 나열하면 나중에
기본값이 바뀌어도 이 저장소만 옛날 값에 묶인다.

## 고르기

### 1. 조사한다

이 스킬 디렉터리의 `scripts/survey.mjs` 를 실행한다. 스킬을 불러올 때 표시되는
base directory 가 그 기준 경로다.

```
node "<이 스킬 디렉터리>/scripts/survey.mjs"
```

읽기만 하는 스크립트다. 진행 중인 워크트리와 각각이 점유한 영역, 열린 PR, 열린
이슈와 Project 의 Priority·Status 를 모아 순위를 매겨 보여준다. `--json` 을
붙이면 같은 내용을 기계가 읽을 형태로 준다.

`git` 과 인증된 `gh` 가 필요하다. 외부 패키지는 쓰지 않으므로 `node_modules` 가
없는 새 워크트리에서도 돈다.

### 2. 고른다

스크립트가 매기는 순위는 이 순서다.

| 순위 | 기준 |
| --- | --- |
| 1 | 이미 내가 선점한 것 — 걸어둔 것부터 끝낸다 |
| 2 | Priority — 설정한 순서대로, 미설정은 맨 뒤 |
| 3 | 겹침 — 진행 중 작업과 영역이 겹치면 뒤로 |
| 4 | Status — 설정한 순서대로 |
| 5 | 라벨 — `bug` > `enhancement` > 그 외 |
| 6 | 이슈 번호 — 오래된 것 먼저 |

**하드 제외**(후보에서 아예 빠짐)는 이런 경우다.

- **다른 사람이** 담당이다 (내가 담당인 것은 빼지 않는다 — 1 순위로 올라온다)
- Status 가 제외 목록에 있다
- 진행 중인 워크트리·PR 이 그 이슈를 참조한다
- 아직 열려 있는 이슈에 막혀 있다 (`blockedBy`)
- 하위 이슈 중 하나를 누가 이미 하고 있다 (`subIssues`)

뒤의 둘은 GitHub 의 이슈 관계를 그대로 읽는다. 앞의 셋과 달리 "지금 이걸
집으면 안 되는" 이유가 이슈 자체에 적혀 있는 경우다.

**혼자 정하지 말고 고르게 하라.** 상위 3 개를 근거와 함께 선택지로 내놓는다.
1 순위에는 추천 표시를 붙인다. 무엇을 고르든 그다음은 똑같이 끝까지 간다 —
선점하고, 새 세션을 열고, 착수까지.

선택지는 Claude Code 의 질문 UI 로 낸다. 방향키로 고를 수 있고, 사람이 답을
적어 넣을 필요가 없다. 스크립트로 대화형 목록을 띄우려 하지 마라 — 도구로
실행되는 스크립트에는 TTY 가 없어서 방향키 입력을 받을 수 없다.

묻지 않고 바로 가는 경우도 있다.

- **사람이 이미 이슈를 지목했을 때.** "#33 해줘" 라면 그대로 간다.
- **"알아서" 라고 했을 때.** 1 순위를 잡는다.

반대로 **후보 전부가 겹칠 때**는 목록만 내놓고 멈춰라. 겹침을 무릅쓰고 진행할지,
지금은 안 띄울지는 사람이 정할 문제다.

스크립트가 남긴 경고는 선택지와 함께 전하라. 특히 "워크트리가 어느 이슈인지
특정하지 못했다"는 경고는, 그 워크트리가 후보 목록에 남아 있는 이슈를 이미 하고
있을 수 있다는 뜻이다.

### 3. 선점한다

고른 즉시 다른 세션·다른 사람이 같은 걸 집지 못하게 표시한다.

```
node "<이 스킬 디렉터리>/scripts/claim.mjs" <번호>
```

담당자로 자신을 걸고, Project Status 를 `In Progress` 로 옮기고, **정말 내 것이
되었는지 되읽어 확인한다.**

되읽기가 핵심이다. GitHub 에는 이슈를 원자적으로 잠그는 수단이 없어서, 같은
순간에 둘이 집으면 둘 다 담당자로 올라간다. 스크립트는 그걸 발견하면 0 이 아닌
값으로 끝난다.

**종료 코드가 0 이 아니면 그 이슈를 버리고 다음 후보로 넘어가라.** 경합에 진
것이다. 스크립트가 담당을 떼는 명령까지 알려준다.

Status 를 건드리고 싶지 않으면 `--no-status`, 다른 값으로 옮기려면
`--status <값>` 을 준다.

### 3-1. 이미 내가 선점해 둔 것

후보에 `이미 내가 선점함 — 이어받기` 가 붙어 있으면, 지난번에 걸어두고 아직
시작하지 않은 작업이다. 순위에서 가장 앞에 온다. 이미 내 담당이므로 선점을
다시 할 필요는 없다 — 바로 4 절로 간다.

### 4. 새 세션을 연다

```
node "<이 스킬 디렉터리>/scripts/launch.mjs" <영역>/<슬러그> <번호>
```

설정의 `launch` 가 방식을 고른다.

- `print` (기본) — 붙여넣을 명령 한 줄을 출력한다. 사람이 새 터미널에 붙여넣는다.
- `session` — 새 창을 열어 그 안에서 세션을 바로 시작한다.

`--print` / `--session` 으로 한 번만 다르게 할 수도 있다. `--dry-run` 은 무엇을
실행할지만 보여준다.

워크트리 이름은 `frontend/splash-safe-area` 처럼 `<영역>/<슬러그>` 로 짓는다.
영역은 이슈의 영역 라벨에서 이모지 같은 장식을 뗀 이름이고, 슬러그는 이슈
내용을 요약한 짧은 영문이다. 스크립트가 이름을 검사하니 이상한 글자를 넣지 마라.

`session` 이 실패하면(창 여는 방법을 못 찾거나 터미널 실행이 실패하면) 붙여넣을
명령을 대신 내놓는다. 그 명령을 사람에게 그대로 전하라.

## 착수

새로 뜬 세션이 `/work-issue <번호>` 로 여기 들어온다.

### 1. 브랜치 이름을 고친다

`claude --worktree foo` 는 브랜치를 `worktree-foo` 로 만든다. 저장소의 브랜치
관례가 따로 있으면 바로 고친다.

```
git branch -m <영역>/<슬러그>
```

### 2. 환경을 갖춘다

워크트리는 새 체크아웃이라 설치물이 없다. 저장소 루트
`.claude/parallel-work.json` 의 `setup` 에 영역별 준비 명령이 있다. **건드릴
영역의 것만** 실행한다 — 전부 돌리면 새 세션이 시작도 전에 몇 분을 잡아먹는다.

gitignore 된 `.env` 류는 저장소 루트의 `.worktreeinclude` 가 자동으로 복사한다.
**사람이 그 파일을 미리 만들어 둘 필요는 없다.** `launch.mjs` 가 새 세션을 열기
직전에 빠진 것을 찾아 채우고, 무엇을 더했는지 알린다.

### 3. 이슈를 읽는다

```
gh issue view <번호> --comments
```

본문과 댓글 전부 읽어라. 설계 결정이 댓글에 남아 있는 경우가 많다.

### 4. draft PR 을 먼저 연다

작업을 **시작하면서** 연다. 다 만들고 나서가 아니다.

```
git commit --allow-empty -m "chore: <제목> 작업을 시작한다"
git push -u origin <영역>/<슬러그>
gh pr create --draft --title "<제목>" --body "Closes #<번호>"
```

이유는 이 도구가 무엇을 볼 수 있는지에 있다. 로컬 워크트리는 **내 머신에서만**
보이고, 그마저 어느 이슈의 작업인지는 연결된 PR 이 있어야 안다. 열린 draft PR
하나가 그 둘을 동시에 메운다 — 남에게도 보이고, 나중에 세션을 하나 더 띄우는
나에게도 보인다.

`Closes #<번호>` 를 꼭 넣어라. 이 도구는 본문의 `#N` 을 아무거나 줍지 않고
GitHub 이 실제로 연결한 이슈만 본다. 저장소에 PR 템플릿이 있으면 그것을 따르되
이 줄은 반드시 넣는다.

### 5. 평소 작업 흐름으로 넘어간다

여기서부터는 이 스킬의 일이 아니다. 저장소의 평소 개발 흐름을 따른다.

### 6. 마무리

작업이 끝나면 draft 를 푼다.

```
gh pr ready
```

## 이 스킬이 일부러 하지 않는 것

- **워크트리를 직접 만들지 않는다.** `claude --worktree` 가 이미 한다.
- **우선순위를 스스로 정하지 않는다.** Project 의 Priority 필드가 유일한
  출처다. 비어 있으면 채우자고 제안하되, 임의로 넣지 마라.
- **겹치는 후보밖에 없을 때 임의로 고르지 않는다.** 사람에게 묻는다.
