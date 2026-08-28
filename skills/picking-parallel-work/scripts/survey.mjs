#!/usr/bin/env node
/**
 * 병렬 작업 고르기 — 지금 In flight과 겹치지 않는 다음 이슈를 찾아 순위를 매긴다.
 *
 * 여러 Claude 세션을 워크트리마다 하나씩 띄워 병렬로 굴릴 때, 사람이 매번
 * "지금 뭐가 돌고 있더라"를 기억해서 겹치지 않는 일감을 고르는 건 오래 못 간다.
 * 이 스크립트가 그 조사를 대신한다. 읽기만 하고 아무것도 바꾸지 않는다 —
 * 선점은 판단이 끝난 뒤 스킬이 별도로 수행한다.
 *
 * 조사하는 것
 *   1. 진행 중인 워크트리와 각각이 점유한 영역 (changed files → 영역, 없으면 브랜치 접두사)
 *   2. 열린 PR 과 그 PR 이 참조하는 이슈
 *   3. 열린 이슈 + GitHub Project 의 Priority / Status
 *
 * 설정
 *   저장소 루트의 .claude/parallel-work.json 을 읽는다. 없으면 아래 DEFAULTS 로
 *   돈다. 설정 파일의 자세한 형태는 플러그인 README 를 보라.
 *
 * 요구사항
 *   git, gh (인증된 상태), node 18+. 외부 패키지는 쓰지 않는다 —
 *   node_modules 가 없는 새 워크트리에서도 돌아야 한다.
 *
 * 사용
 *   node <플러그인>/skills/picking-parallel-work/scripts/survey.mjs [--json]
 */

import fs from 'node:fs';
import path from 'node:path';

import {
    currentUser,
    ghJson,
    git,
    loadConfig,
    repoOwner,
    repoRoot,
    resolveProjectNumber,
    uniqueWarnings,
    warnings,
} from './lib.mjs';

/** 영역 자동 추론에서 빼는 최상위 디렉터리. 어느 저장소에나 있고 영역이 아니다. */
const NON_AREA_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'out']);

const wantJson = process.argv.includes('--json');

// --- 영역 판정 ---------------------------------------------------------------

/**
 * 영역 → 글롭 목록.
 *
 * 1순위는 actions/labeler 설정이다. PR 라벨과 같은 규칙을 써야 "라벨이 말하는
 * 영역"과 "겹침 판정이 말하는 영역"이 갈라지지 않는다.
 * 그 파일이 없으면 최상위 디렉터리를 영역으로 삼는다.
 */
function loadAreaGlobs(root, config) {
    const file = path.join(root, config.areaSource);
    if (fs.existsSync(file)) return parseLabelerConfig(fs.readFileSync(file, 'utf8'), config.areaSource);

    const areas = new Map();
    for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || NON_AREA_DIRS.has(entry.name)) continue;
        areas.set(entry.name, [`${entry.name}/**`]);
    }
    warnings.push(`No ${config.areaSource}, so top-level directories were used as areas: ${[...areas.keys()].join(', ')}`);
    return areas;
}

/**
 * actions/labeler 설정에서 영역 → 글롭을 뽑는다.
 *
 * 의존성 없이 돌아야 해서 YAML 파서를 쓰지 않는다. 대신 이 형식만 정확히 읽고,
 * 모르는 모양을 만나면 조용히 넘어가지 않고 예외를 던진다. 설정이 바뀌면 겹침
 * 판정이 틀리기 전에 여기서 먼저 터져야 한다.
 *
 * head-branch 규칙은 무시한다. 이 스크립트가 궁금한 건 "어떤 파일이 어느
 * 영역인가" 뿐이다.
 */
function parseLabelerConfig(text, sourceName) {
    const areas = new Map();
    let area = null;
    let inGlobList = false;

    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/\s+$/, '');
        if (!line || line.trimStart().startsWith('#')) continue;

        const top = line.match(/^(\S.*):$/);
        if (top) {
            area = top[1];
            areas.set(area, []);
            inGlobList = false;
            continue;
        }
        if (!area) throw new Error(`${sourceName}: content appeared before any top-level label key — "${line}"`);

        const trimmed = line.trim();
        if (trimmed === '- changed-files:') {
            inGlobList = false;
            continue;
        }
        if (trimmed.startsWith('- head-branch:') || trimmed.startsWith('- base-branch:')) {
            inGlobList = false;
            continue;
        }
        const scalar = trimmed.match(/^- any-glob-to-any-file:\s*(.+)$/);
        if (scalar) {
            areas.get(area).push(unquote(scalar[1]));
            inGlobList = false;
            continue;
        }
        if (trimmed === '- any-glob-to-any-file:') {
            inGlobList = true;
            continue;
        }
        if (inGlobList && trimmed.startsWith('- ')) {
            areas.get(area).push(unquote(trimmed.slice(2)));
            continue;
        }
        throw new Error(`${sourceName}: cannot parse this line — "${line}"`);
    }
    return areas;
}

function unquote(value) {
    const v = value.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
    return v;
}

/**
 * 글롭을 정규식으로. labeler 설정이 쓰는 만큼만 지원한다:
 * `**` (경로 구분자 포함, 디렉터리 0 개도 매칭), `*` (구분자 제외), 그 외 리터럴.
 */
function globToRegExp(glob) {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                i++;
                if (glob[i + 1] === '/') {
                    i++;
                    out += '(?:.*/)?';
                } else {
                    out += '.*';
                }
            } else {
                out += '[^/]*';
            }
        } else if ('\\^$+?.()|{}[]'.includes(c)) {
            out += '\\' + c;
        } else {
            out += c;
        }
    }
    return new RegExp(`^${out}$`);
}

function areasForPaths(paths, areaGlobs) {
    const found = new Set();
    for (const [area, globs] of areaGlobs) {
        const patterns = globs.map(globToRegExp);
        if (paths.some((p) => patterns.some((re) => re.test(p)))) found.add(area);
    }
    return found;
}

/**
 * 영역 이름 비교용 정규화. 글자와 숫자만 남기고 소문자로 만든다.
 *
 * 이슈의 영역은 라벨 이름에서, 워크트리의 영역은 파일 경로에서 온다. 이 둘이
 * 글자 그대로 같으리라 기대할 수 없다 — 라벨은 `🖥️frontend` 인데 폴백으로 잡은
 * 영역은 디렉터리 이름 `frontend` 이고, `Front-End` 처럼 쓰는 저장소도 있다.
 * 여기서 맞춰주지 않으면 actions/labeler 를 쓰지 않는 저장소에서 모든 이슈가
 * "영역 없음" 이 되어 겹침 판정이 통째로 죽는다.
 */
function normalizeArea(name) {
    return String(name)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/** 정규화한 이름 → 원래 영역 이름. 충돌하면 먼저 온 것을 남기고 알린다. */
function areaLookup(areaNames) {
    const byNorm = new Map();
    for (const name of areaNames) {
        const key = normalizeArea(name);
        if (!key) continue;
        if (byNorm.has(key)) {
            warnings.push(`Areas "${name}" and "${byNorm.get(key)}" normalize to the same name. Keeping the first.`);
            continue;
        }
        byNorm.set(key, name);
    }
    return byNorm;
}

// --- In flight ----------------------------------------------------------

/** git worktree list --porcelain 을 파싱한다. 첫 항목이 주 체크아웃이다. */
function listWorktrees() {
    const entries = [];
    let cur = null;
    for (const line of git(['worktree', 'list', '--porcelain']).split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
            cur = {path: line.slice('worktree '.length), branch: null, locked: false};
            entries.push(cur);
        } else if (line.startsWith('branch ') && cur) {
            cur.branch = line.slice('branch refs/heads/'.length);
        } else if (line === 'locked' && cur) {
            cur.locked = true;
        }
    }
    return entries.slice(1);
}

/** 워크트리가 지금까지 건드린 파일. 커밋된 것과 아직 커밋 안 한 것 모두. */
function changedPathsIn(worktreePath, defaultBranch) {
    const paths = new Set();
    try {
        for (const line of git(['-C', worktreePath, 'diff', '--name-only', `${defaultBranch}...HEAD`]).split(/\r?\n/)) {
            if (line) paths.add(line);
        }
    } catch {
        // 방금 만들어 기본 브랜치와 비교할 수 없는 워크트리 — 아래 status 만으로 판단한다
    }
    try {
        for (const line of git(['-C', worktreePath, 'status', '--porcelain']).split(/\r?\n/)) {
            const p = line.slice(3).trim();
            if (p) paths.add(p);
        }
    } catch {
        // 읽을 수 없는 워크트리는 영역 없음으로 두고 경고에서 드러난다
    }
    return [...paths];
}

/** origin 의 기본 브랜치. 없으면 main 으로 가정한다. */
function defaultBranchRef() {
    try {
        return git(['rev-parse', '--abbrev-ref', 'origin/HEAD']);
    } catch {
        warnings.push('Could not read origin/HEAD, assuming origin/main is the default branch');
        return 'origin/main';
    }
}

/**
 * PR 이 실제로 처리 중인 이슈.
 *
 * 1순위는 GitHub 이 스스로 연결한 closingIssuesReferences 다. 본문의 `#N` 을
 * 전부 긁으면 안 된다 — 설명에 다른 이슈를 언급하거나 예시 출력을 붙여넣기만 해도
 * 그 이슈들이 통째로 "진행 중"으로 잘못 제외된다.
 *
 * 연결이 비어 있을 때만 본문에서 닫기 키워드가 붙은 참조를 찾는다.
 */
function closingIssues(pr) {
    const linked = (pr.closingIssuesReferences || []).map((r) => r.number).filter((n) => typeof n === 'number');
    if (linked.length > 0) return [...new Set(linked)];

    const nums = new Set();
    const pattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
    for (const m of String(pr.body || '').matchAll(pattern)) nums.add(Number(m[1]));
    return [...nums];
}

/**
 * 새 워크트리에 따라가지 못할 로컬 설정이 있는지 본다.
 *
 * 워크트리는 새 체크아웃이라 gitignore 된 .env 류가 없다. 저장소 루트의
 * .worktreeinclude 에 적어두면 Claude Code 가 복사해 주는데, 사람이 그 파일의
 * 존재를 미리 알고 있어야 한다는 게 문제다. 모르면 새 세션이 빌드부터 실패하고,
 * 원인도 바로 보이지 않는다.
 *
 * 그래서 여기서 먼저 찾아 알린다. 흔한 이름만 얕게 훑는다 — 저장소 전체를
 * 뒤지는 비용을 들일 만한 문제가 아니고, 실제로 걸리는 것은 늘 이 몇 가지다.
 */
function missingWorktreeIncludes(root) {
    const NAMES = /^(\.env(\..+)?|local\.properties)$/;
    const MAX_DEPTH = 2;

    const found = [];
    const walk = (dir, rel, depth) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, {withFileTypes: true});
        } catch {
            return;
        }
        for (const e of entries) {
            const childRel = rel ? `${rel}/${e.name}` : e.name;
            if (e.isFile() && NAMES.test(e.name)) found.push(childRel);
            else if (e.isDirectory() && depth < MAX_DEPTH && !e.name.startsWith('.') && !NON_AREA_DIRS.has(e.name)) {
                walk(path.join(dir, e.name), childRel, depth + 1);
            }
        }
    };
    walk(root, '', 0);
    if (found.length === 0) return;

    // 추적되는 파일은 워크트리에도 그대로 있다. 빠지는 것은 gitignore 된 것뿐이다.
    const ignored = found.filter((f) => {
        try {
            git(['check-ignore', '-q', f]);
            return true;
        } catch {
            return false;
        }
    });
    if (ignored.length === 0) return;

    const listed = new Set();
    try {
        for (const line of fs.readFileSync(path.join(root, '.worktreeinclude'), 'utf8').split(/\r?\n/)) {
            const t = line.trim();
            if (t && !t.startsWith('#')) listed.add(t);
        }
    } catch {
        // 파일이 없으면 아무것도 안 딸려간다
    }

    const uncovered = ignored.filter((f) => !listed.has(f));
    if (uncovered.length === 0) return;

    warnings.push(
        `These gitignored files will be missing from a new worktree: ${uncovered.join(', ')}. ` +
            `Add them to .worktreeinclude at the repository root so Claude Code copies them in.`
    );
}

// --- 본체 -------------------------------------------------------------------

function main() {
    const root = repoRoot();
    const config = loadConfig(root);
    const areaGlobs = loadAreaGlobs(root, config);
    missingWorktreeIncludes(root);
    const areaNames = [...areaGlobs.keys()];
    const areaByNorm = areaLookup(areaNames);
    const defaultBranch = defaultBranchRef();

    const owner = repoOwner();

    const issues =
        ghJson([
            'issue',
            'list',
            '--state',
            'open',
            '--limit',
            '200',
            '--json',
            'number,title,labels,assignees,url',
        ]) || [];

    const prs =
        ghJson([
            'pr',
            'list',
            '--state',
            'open',
            '--limit',
            '200',
            '--json',
            'number,title,body,headRefName,files,author,isDraft,closingIssuesReferences',
        ]) || [];

    // 담당자가 나인지 남인지 갈라야 한다. 내 담당은 이어받을 것이고, 남의 담당은
    // 건드리면 안 되는 것이다.
    const me = currentUser();
    if (!me) warnings.push('Could not tell who you are, so your own assignments were not distinguished from anyone else');

    const projectByIssue = loadProjectMeta(owner, config);

    // 진행 중인 워크트리
    const worktrees = listWorktrees().map((wt) => {
        const paths = changedPathsIn(wt.path, defaultBranch);
        let areas = areasForPaths(paths, areaGlobs);
        let areaSource = 'changed files';
        if (areas.size === 0 && wt.branch) {
            const prefix = wt.branch.split('/')[0];
            // 부분 문자열로 맞추면 안 된다. 브랜치 접두사 "ai" 가 "maintenance" 같은
            // 무관한 영역 이름에 걸린다. 정규화한 이름끼리 정확히 같을 때만 인정한다.
            const guess = areaByNorm.get(normalizeArea(prefix));
            if (guess) {
                areas = new Set([guess]);
                areaSource = 'guessed from branch name';
            }
        }
        const pr = prs.find((p) => p.headRefName === wt.branch);
        const refs = pr ? closingIssues(pr) : [];
        return {
            path: wt.path,
            branch: wt.branch,
            locked: wt.locked,
            changedCount: paths.length,
            areas: [...areas],
            areaSource,
            issues: [...refs],
        };
    });

    // 남의 워크트리는 보이지 않는다. `git worktree list` 는 내 머신만 안다.
    // 열린 PR 의 changed files이 팀의 진행 중 작업을 보는 유일한 창이다.
    const openPrs = prs.map((pr) => ({
        number: pr.number,
        branch: pr.headRefName,
        author: pr.author?.login || '?',
        isDraft: Boolean(pr.isDraft),
        areas: [...areasForPaths((pr.files || []).map((f) => f.path), areaGlobs)],
        issues: closingIssues(pr),
    }));

    const occupiedAreas = new Set();
    for (const wt of worktrees) for (const a of wt.areas) occupiedAreas.add(a);
    for (const pr of openPrs) for (const a of pr.areas) occupiedAreas.add(a);

    const inFlight = new Set();
    for (const wt of worktrees) for (const n of wt.issues) inFlight.add(n);
    for (const pr of openPrs) for (const n of pr.issues) inFlight.add(n);

    // 특정 못한 워크트리는 조용히 넘기지 않는다 — 사람이 봐야 할 불확실성이다
    for (const wt of worktrees) {
        if (wt.issues.length === 0) {
            warnings.push(
                `Could not tell which issue worktree ${wt.branch || wt.path} belongs to (no open PR). ` +
                    `Only its areas (${wt.areas.join(', ') || 'unknown'}) were counted as occupied.`
            );
        }
    }

    // 후보 평가
    const candidates = issues.map((issue) => {
        const labels = issue.labels.map((l) => l.name);
        // 라벨 이름을 그대로 비교하지 않는다 — normalizeArea 의 설명을 보라.
        const areas = [...new Set(labels.map((l) => areaByNorm.get(normalizeArea(l))).filter(Boolean))];
        const meta = projectByIssue.get(issue.number) || {status: '', priority: ''};

        const assignees = issue.assignees.map((a) => a.login);
        const others = me ? assignees.filter((a) => a !== me) : assignees;
        // 담당자를 모르면(me 를 못 알아냈으면) 남의 것으로 보고 보수적으로 뺀다
        const minePending = Boolean(me) && assignees.includes(me) && others.length === 0;

        const blockers = [];
        if (others.length > 0) blockers.push(`assigned to someone else (${others.join(', ')})`);
        if (config.excludeStatuses.includes(meta.status)) blockers.push(`${config.statusField} = ${meta.status}`);
        if (inFlight.has(issue.number)) blockers.push('referenced by an in-flight worktree or PR');

        return {
            number: issue.number,
            title: issue.title,
            url: issue.url,
            labels,
            areas,
            priority: meta.priority,
            status: meta.status,
            blockers,
            // 내가 선점만 해두고 아직 시작하지 않은 것. 막을 게 아니라 이어받을 것이다.
            minePending,
            overlaps: areas.filter((a) => occupiedAreas.has(a)),
            unknownArea: areas.length === 0,
        };
    });

    const rankKey = (c) => [
        c.minePending ? 0 : 1, // 이미 선점해 둔 내 작업을 먼저 이어받는다
        indexOrLast(config.priorityOrder, c.priority),
        c.overlaps.length > 0 ? 1 : 0, // 겹치면 뒤로 — 제외가 아니라 감점이다
        indexOrLast(config.statusOrder, c.status),
        Math.min(...c.labels.map((l) => indexOrLast(config.labelOrder, l)), config.labelOrder.length),
        c.number,
    ];

    const ranked = candidates.filter((c) => c.blockers.length === 0).sort((a, b) => cmp(rankKey(a), rankKey(b)));
    const blocked = candidates.filter((c) => c.blockers.length > 0).sort((a, b) => a.number - b.number);

    const result = {
        me,
        occupiedAreas: [...occupiedAreas],
        worktrees,
        openPrs,
        ranked,
        blocked,
        warnings,
    };
    if (wantJson) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
    }
    report(result, config);
}

/** Project 의 Priority / Status 를 이슈 번호로 색인한다. */
function loadProjectMeta(owner, config) {
    const byIssue = new Map();
    if (!owner) return byIssue;

    const number = resolveProjectNumber(owner, config);
    if (number == null) return byIssue;

    const proj = ghJson([
        'project',
        'item-list',
        String(number),
        '--owner',
        owner,
        '--limit',
        '500',
        '--format',
        'json',
    ]);
    // gh 는 필드 이름을 소문자 키로 내려준다. 대소문자를 가리지 않고 찾는다.
    const fieldOf = (item, name) => {
        const key = Object.keys(item).find((k) => k.toLowerCase() === name.toLowerCase());
        return key ? item[key] : undefined;
    };
    for (const item of proj?.items || []) {
        const num = item?.content?.number;
        if (typeof num === 'number') {
            byIssue.set(num, {
                status: fieldOf(item, config.statusField) || '',
                priority: fieldOf(item, config.priorityField) || '',
            });
        }
    }
    return byIssue;
}

function indexOrLast(order, value) {
    const i = order.indexOf(value);
    return i === -1 ? order.length : i;
}

function cmp(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
}

function report({me, worktrees, openPrs, occupiedAreas, ranked, blocked, warnings}, config) {
    const out = [];

    out.push(`In flight${me ? `  you: ${me}` : ''}`);
    if (worktrees.length === 0 && openPrs.length === 0) {
        out.push('  (nothing — no work to collide with)');
    }
    for (const wt of worktrees) {
        const issues = wt.issues.length ? `#${wt.issues.join(', #')}` : 'issue unknown';
        out.push(
            `  [worktree] ${wt.branch || wt.path}  ${issues}  ${wt.changedCount} files` +
                `  areas: ${wt.areas.join(', ') || 'unknown'} (from ${wt.areaSource})` +
                (wt.locked ? '  [locked]' : '')
        );
    }
    for (const pr of openPrs) {
        const issues = pr.issues.length ? `#${pr.issues.join(', #')}` : 'issue unknown';
        out.push(
            `  [open PR] #${pr.number} ${pr.branch}  ${pr.author}${pr.isDraft ? ' (draft)' : ''}  ${issues}` +
                `  areas: ${pr.areas.join(', ') || 'unknown'}`
        );
    }
    out.push(`  occupied areas: ${occupiedAreas.join(', ') || 'none'}`);
    out.push('');

    out.push(`Available candidates (${ranked.length}, best first)`);
    for (const c of ranked.slice(0, 8)) {
        const bits = [
            ...(c.minePending ? ['already claimed by you — pick it back up'] : []),
            c.priority || 'no priority',
            c.status || `no ${config.statusField}`,
            ...c.areas,
        ];
        const note = c.overlaps.length
            ? `  ⚠ overlaps: ${c.overlaps.join(', ')}`
            : c.unknownArea
              ? '  ⚠ no area label — cannot check overlap'
              : '';
        out.push(`  #${String(c.number).padEnd(3)} ${c.title}`);
        out.push(`       ${bits.join(' · ')}${note}`);
    }
    out.push('');

    if (blocked.length) {
        out.push(`Excluded (${blocked.length})`);
        for (const c of blocked) {
            out.push(`  #${String(c.number).padEnd(3)} ${c.title}`);
            out.push(`       ${c.blockers.join(' / ')}`);
        }
        out.push('');
    }

    const uniq = uniqueWarnings();
    if (uniq.length) {
        out.push('Worth checking');
        for (const w of uniq) out.push(`  - ${w}`);
        out.push('');
    }

    process.stdout.write(out.join('\n') + '\n');
}

main();
