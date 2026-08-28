/**
 * survey.mjs 와 claim.mjs 가 함께 쓰는 것들.
 *
 * 설정 기본값과 gh 호출 방식이 두 스크립트에서 갈리면, 조사할 때의 판단과
 * 선점할 때의 판단이 서로 다른 저장소를 보게 된다.
 */

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 설정하지 않았을 때의 기본값.
 *
 * projectNumber 가 null 이면 저장소 소유자의 Project 를 찾아보고, 정확히 하나일
 * 때만 그걸 쓴다. 여러 개면 어느 것인지 사람이 정해야 한다.
 */
export const DEFAULTS = {
    projectNumber: null,
    priorityField: 'Priority',
    priorityOrder: ['P0', 'P1', 'P2'],
    statusField: 'Status',
    statusOrder: ['Todo', '', 'Backlog'],
    excludeStatuses: ['In Progress', 'Done'],
    labelOrder: ['bug', 'enhancement'],
    areaSource: '.github/labeler.yaml',
    /**
     * 고른 뒤 새 세션을 어떻게 여는가.
     *   "print"   (기본) 붙여넣을 명령을 출력한다
     *   "session" 새 창을 열어 그 안에서 세션을 시작한다
     */
    launch: 'print',
    /**
     * 선점할 때 Project Status 를 이 값으로 옮긴다. null 이면 옮기지 않는다.
     */
    // claimStatus: 적지 않으면 claimStatusFor 가 정한다
};

/**
 * 선점할 때 옮길 Status.
 *
 * 혼자 쓴다고 Status 를 생략하면 안 된다. 이 도구가 존재하는 이유가 세션을
 * 여럿 굴리는 것이고, 그러면 행위자도 여럿이다. Status 는 그 세션들이 공유하는
 * 유일한 신호다 — 담당자만으로는 "잡아만 둔 것"과 "지금 붙어 있는 것"을 가르지
 * 못한다.
 *
 * 끄고 싶으면 설정에 claimStatus: null 을 명시하라.
 */
export function claimStatusFor(config) {
    return config.claimStatus !== undefined ? config.claimStatus : 'In Progress';
}

export const CONFIG_PATH = '.claude/parallel-work.json';

export const WORKTREE_INCLUDE = '.worktreeinclude';

/** 영역 추론과 로컬 설정 탐색에서 빼는 디렉터리. 어느 저장소에나 있다. */
export const NON_AREA_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'out']);

/**
 * 새 워크트리에 따라가지 못할 로컬 설정 파일.
 *
 * 워크트리는 새 체크아웃이라 gitignore 된 .env 류가 없다. 저장소 루트의
 * .worktreeinclude 에 적혀 있어야 Claude Code 가 복사해 준다. 사람이 그 파일의
 * 존재를 미리 알고 있어야 한다는 게 문제라, 여기서 찾아낸다.
 *
 * 흔한 이름만 얕게 훑는다. 저장소 전체를 뒤질 만한 문제가 아니고, 실제로 걸리는
 * 것은 늘 이 몇 가지다.
 */
export function findUncoveredLocalConfig(root) {
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
    if (found.length === 0) return [];

    // 추적되는 파일은 워크트리에도 그대로 있다. 빠지는 것은 gitignore 된 것뿐이다.
    const ignored = found.filter((f) => {
        try {
            git(['check-ignore', '-q', f]);
            return true;
        } catch {
            return false;
        }
    });
    if (ignored.length === 0) return [];

    const listed = new Set();
    try {
        for (const line of fs.readFileSync(path.join(root, WORKTREE_INCLUDE), 'utf8').split(/\r?\n/)) {
            const t = line.trim();
            if (t && !t.startsWith('#')) listed.add(t);
        }
    } catch {
        // 파일이 없으면 아무것도 안 딸려간다
    }
    return ignored.filter((f) => !listed.has(f));
}

/** 실패를 모아 마지막에 한자리에서 보여준다. */
export const warnings = [];

/**
 * 자식 프로세스의 stderr 는 삼킨다. 실패는 전부 경고로 모으므로, git·gh 의
 * 원본 오류가 중간에 끼어들면 보고서만 읽기 어려워진다.
 */
export function run(file, args, opts = {}) {
    return execFileSync(file, args, {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...opts,
    });
}

export function git(args) {
    return run('git', args).trimEnd();
}

/** 실패 원인 중 사람이 읽을 만한 첫 줄. */
export function firstLine(err) {
    const text = String(err.stderr || err.message || '').trim();
    return text.split('\n')[0] || 'unknown error';
}

/** gh 호출. 실패해도 전체를 죽이지 않고 null 을 돌려준다. */
export function ghJson(args) {
    try {
        return JSON.parse(run('gh', args));
    } catch (err) {
        warnings.push(`gh ${args.slice(0, 2).join(' ')} failed — ${firstLine(err)}`);
        return null;
    }
}

/** JSON 이 아니라 맨 문자열을 돌려주는 gh 호출 (--jq 로 스칼라를 뽑을 때). */
export function ghText(args) {
    try {
        return run('gh', args).trim() || null;
    } catch (err) {
        warnings.push(`gh ${args.slice(0, 2).join(' ')} failed — ${firstLine(err)}`);
        return null;
    }
}

/**
 * 저장소 루트. 워크트리 하위 디렉터리에서 불릴 수 있으므로 cwd 를 믿지 않는다.
 * 워크트리 안에서는 그 워크트리의 루트를 준다.
 */
export function repoRoot() {
    return git(['rev-parse', '--show-toplevel']);
}

export function loadConfig(root) {
    const file = path.join(root, CONFIG_PATH);
    if (!fs.existsSync(file)) return {...DEFAULTS};
    try {
        return {...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8'))};
    } catch (err) {
        // 설정이 깨졌으면 조용히 기본값으로 넘어가지 않는다. 순위가 말없이 달라진다.
        throw new Error(`Could not read ${CONFIG_PATH} — ${err.message}`);
    }
}

/**
 * PR 이 실제로 처리 중인 이슈.
 *
 * 1순위는 GitHub 이 스스로 연결한 closingIssuesReferences 다. 본문의 `#N` 을
 * 전부 긁으면 안 된다 — 설명에 다른 이슈를 언급하거나 예시 출력을 붙여넣기만 해도
 * 그 이슈들이 통째로 "진행 중"으로 잘못 제외된다.
 *
 * 본문의 닫기 키워드와 제목의 참조도 함께 본다.
 *
 * 제목을 보는 이유는 이슈를 쪼개 작업하는 흔한 방식 때문이다. "(#18 ①)" 처럼
 * 3 부작의 1 부를 여는 PR 은 Closes 를 쓰면 안 되고, 그러면 GitHub 이 연결해 주지
 * 않아 #18 이 후보에 그대로 남는다. 두 세션이 같은 이슈의 다른 조각을 동시에
 * 하게 되는 자리다.
 *
 * 본문 전체에서 #N 을 긁지는 않는다. 설명에 다른 이슈를 언급하거나 예시 출력을
 * 붙여넣기만 해도 무관한 이슈가 통째로 잠긴다. 제목은 사람이 다듬는 자리라
 * 이슈 번호가 우연히 들어가지 않는다.
 */
export function closingIssues(pr) {
    const nums = new Set();
    for (const r of pr.closingIssuesReferences || []) {
        if (typeof r.number === 'number') nums.add(r.number);
    }
    for (const m of String(pr.title || '').matchAll(/#(\d+)/g)) nums.add(Number(m[1]));
    const closing = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
    for (const m of String(pr.body || '').matchAll(closing)) nums.add(Number(m[1]));
    return [...nums];
}

/** 저장소 소유자 로그인. */
export function repoOwner() {
    return ghJson(['repo', 'view', '--json', 'owner,name'])?.owner?.login || null;
}

/** 지금 gh 로 인증된 사용자. */
export function currentUser() {
    return ghText(['api', 'user', '--jq', '.login']);
}

/**
 * 쓸 Project 번호를 정한다. 설정에 있으면 그것, 없으면 소유자의 Project 가
 * 정확히 하나일 때만 자동으로. 여러 개면 사람이 정해야 한다.
 */
export function resolveProjectNumber(owner, config) {
    if (config.projectNumber != null) return config.projectNumber;
    if (!owner) return null;

    const projects = ghJson(['project', 'list', '--owner', owner, '--format', 'json'])?.projects || [];
    if (projects.length === 1) return projects[0].number;

    warnings.push(
        projects.length === 0
            ? 'No GitHub Project found'
            : `Found ${projects.length} Projects and cannot tell which to use. Set projectNumber in ${CONFIG_PATH}.`
    );
    return null;
}

/**
 * 같은 경고가 여러 번 쌓일 수 있다 — 같은 검사를 두 곳에서 부르면 그렇다.
 * 읽는 사람에게는 한 번만 보이면 된다.
 */
export function uniqueWarnings() {
    return [...new Set(warnings)];
}

export function printWarnings() {
    const list = uniqueWarnings();
    if (list.length === 0) return;
    process.stdout.write('\nWorth checking\n');
    for (const w of list) process.stdout.write(`  - ${w}\n`);
}
