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
