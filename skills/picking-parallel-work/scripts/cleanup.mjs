#!/usr/bin/env node
/**
 * 끝난 워크트리와 그 브랜치를 치운다 — 이 플러그인이 만든 것만.
 *
 * 왜 필요한가. 조사할 때 `git worktree list` 를 "진행 중인 작업" 으로 읽는다.
 * 머지가 끝난 워크트리를 남겨두면 그것이 계속 진행 중으로 잡히고, 그 영역을
 * 영원히 점유한다. 끝난 frontend 워크트리 하나 때문에 이후 모든 frontend 이슈가
 * 계속 감점되는 식이다. 커밋이 다 들어갔으니 변경 파일도 안 나와서 브랜치 이름
 * 추정으로 넘어가고, 그래서 조용히 틀린다.
 *
 * 왜 여기서 하는가. 워크트리 안의 세션은 자기 워크트리를 지울 수 없다. 그래서
 * 정리는 주 체크아웃에서, 다음 작업을 고르는 시점에 한다 — 마침 낡은 워크트리가
 * 판단을 망치는 그 순간이다.
 *
 * 무엇을 치우지 않는가.
 *   - 이 플러그인이 만들지 않은 브랜치. 저장소 전체의 머지된 브랜치를 훑어
 *     지우는 것은 이 도구의 일이 아니다. 워크트리에 딸린 것만 본다.
 *   - locked 워크트리. Claude Code 가 세션이 도는 동안 잠근다. 아직 살아 있는
 *     세션의 작업 공간을 지울 수는 없다.
 *   - 커밋이 기본 브랜치에 다 들어가지 않았거나, 남은 변경이 있는 워크트리.
 *
 * 사용
 *   node <플러그인>/.../cleanup.mjs            무엇을 지울지만 보여준다
 *   node <플러그인>/.../cleanup.mjs --apply    실제로 지운다
 */

import {defaultBranchRef, git, isFinishedWorktree, listWorktrees, printWarnings, run, warnings} from './lib.mjs';

const apply = process.argv.includes('--apply');

/** 원격 브랜치를 지운다. 이미 없으면(GitHub 이 머지 때 지웠으면) 성공으로 본다. */
function deleteRemote(branch) {
    try {
        run('git', ['push', 'origin', '--delete', branch]);
        return 'deleted';
    } catch {
        return 'already gone';
    }
}

function main() {
    const defaultBranch = defaultBranchRef();
    const worktrees = listWorktrees();

    const finished = [];
    const kept = [];
    for (const wt of worktrees) {
        if (isFinishedWorktree(wt, defaultBranch)) {
            if (wt.locked) kept.push([wt, 'locked — a session may still be running; close it and run this again']);
            else finished.push(wt);
        } else if (wt.branch) {
            kept.push([wt, 'still has work — commits not in ' + defaultBranch + ', or uncommitted changes']);
        }
    }

    if (finished.length === 0) {
        process.stdout.write(`Nothing to clean up (checked ${worktrees.length} worktrees against ${defaultBranch}).\n`);
    } else {
        process.stdout.write(`${apply ? 'Cleaning up' : 'Would clean up'} ${finished.length} finished worktree(s):\n`);
    }

    for (const wt of finished) {
        process.stdout.write(`  ${wt.branch}\n    ${wt.path}\n`);
        if (!apply) continue;

        try {
            git(['worktree', 'remove', wt.path]);
        } catch (err) {
            warnings.push(`Could not remove the worktree at ${wt.path} — ${String(err.message).split('\n')[0]}`);
            continue;
        }
        try {
            // -d 를 쓴다. 머지되지 않은 브랜치는 git 이 거절해야 한다.
            git(['branch', '-d', wt.branch]);
        } catch {
            warnings.push(`Removed the worktree but kept the branch ${wt.branch} — git refused to delete it`);
            continue;
        }
        process.stdout.write(`    removed; remote branch ${deleteRemote(wt.branch)}\n`);
    }

    if (kept.length > 0) {
        process.stdout.write('\nLeft alone:\n');
        for (const [wt, why] of kept) process.stdout.write(`  ${wt.branch || wt.path}\n    ${why}\n`);
    }

    if (!apply && finished.length > 0) process.stdout.write('\nRun again with --apply to do it.\n');
    printWarnings();
}

main();
