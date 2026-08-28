# 작업 규약

## 무엇이 어디에 있나

| | |
| --- | --- |
| `skills/picking-parallel-work/SKILL.md` | 판단 규칙. Claude 가 실제로 따르는 문서다 |
| `skills/picking-parallel-work/scripts/` | 조사·선점·실행. 의존성 없는 Node ESM |
| `commands/` | `/next-task`, `/work-issue` — 스킬로 들어가는 지름길 |
| `README.md` / `README.ko.md` | 사람이 읽는 문서. 영어가 기본, 한국어가 번역본 |

## 코드를 바꿨으면 문서도 바꾼다

같은 동작을 네 곳이 설명한다. 하나만 고치면 나머지가 조용히 틀린 말을 하게 된다.
**작업이 끝났다는 것은 아래가 이미 맞다는 뜻이지, 나중에 손보겠다는 뜻이 아니다.**

| 바꾼 것 | 함께 봐야 할 곳 |
| --- | --- |
| 순위 기준 (`rankKey`) | `SKILL.md` 순위표, `README.md` Ranking, `README.ko.md` 순위 |
| 하드 제외 조건 (`blockers`) | 위와 같은 세 곳의 제외 설명 |
| 설정 기본값 (`DEFAULTS`) | 양쪽 README 의 설정 표와 예시 JSON, `SKILL.md` 설정하기 |
| 선점 절차 (`claim.mjs`) | `SKILL.md` 선점, 양쪽 README 의 Claiming |
| Status 이동 (`set-status.mjs`) | `SKILL.md` 마무리, 양쪽 README 의 머지 후 절 |
| 새 세션 여는 방식 (`launch.mjs`) | `SKILL.md` 4 절, 양쪽 README |
| 스킬이 걸리는 조건 | `SKILL.md` frontmatter `description` |
| 무엇이든 | `.claude-plugin/plugin.json` 의 `version` |

이 표는 `.claude/hooks/docs-drift-check.mjs` 가 커밋 직전에 대조한다. 걸렸을 때는
문서를 고쳐 함께 `git add` 하거나, 읽어보니 고칠 게 없으면
`node .claude/hooks/docs-drift-check.mjs --ack` 후 다시 커밋한다. 버전 누락은
`--ack` 로 넘길 수 없다 — 판단이 아니라 사실이기 때문이다.

**빠져서 틀리는 경우를 조심하라.** 설정 항목을 없애거나 순위 기준을 하나 더하면,
남은 문장은 여전히 읽히지만 이제 틀린 말이다. 문구가 겹치는 곳만 고치지 말고,
그 동작을 설명하는 절을 다시 읽어라. 실제로 새어나간 것이 전부 이런 종류였다.

## 규약

- **의존성을 쓰지 않는다.** 이 스크립트가 도는 주된 환경이 `node_modules` 가 없는
  갓 만들어진 워크트리다.
- **출력은 영어, 주석은 한국어.** 출력은 남이 읽고, 주석은 여기서 일하는 사람이
  읽는다.
- **읽기와 쓰기를 나눈다.** `survey.mjs` 는 아무것도 바꾸지 않는다. 잘못 돌려도
  잃을 게 없어야 판단을 맡길 수 있다.
- **모르면 조용히 넘어가지 않는다.** 값을 정하지 못했으면 기본값으로 때우지 말고
  경고로 남겨라. 순위가 말없이 달라지는 것이 가장 나쁘다.
- **저장소 고유값을 박지 않는다.** 영역 이름·라벨·Project 번호는 전부 런타임에
  읽는다. 기본값은 GitHub 이 기본 제공하는 것(`bug`, `Todo`…)까지만.
