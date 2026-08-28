#!/usr/bin/env node
/**
 * 이슈 선점 — 담당자로 자신을 걸고, 정말 내 것이 되었는지 되읽어 확인한다.
 *
 * GitHub 에는 이슈를 원자적으로 잠그는 수단이 없다. 두 사람(또는 두 세션)이 같은
 * 순간에 같은 이슈를 집으면 둘 다 담당자로 올라간다. 그래서 걸고 나서 **다시
 * 읽는다.** 나 말고 다른 사람이 함께 올라와 있으면 내가 늦은 것으로 보고 물러난다.
 * 이 되읽기가 락을 대신한다.
 *
 * Project 의 Status 도 함께 옮긴다. 필드·옵션 ID 를 사람이 뒤질 일이 아니라
 * 여기서 알아낸다.
 *
 * 사용
 *   node <플러그인>/skills/picking-parallel-work/scripts/claim.mjs <이슈번호>
 *   node ... claim.mjs 29 --no-status     Status 는 건드리지 않는다
 *   node ... claim.mjs 29 --status Doing  다른 Status 값으로 옮긴다
 *
 * 종료 코드
 *   0  선점 성공
 *   1  선점 실패 (경합에 졌거나 인자가 잘못됨) — 다음 후보로 넘어가라
 */

import {
    claimStatusFor,
    currentUser,
    ghJson,
    ghText,
    loadConfig,
    printWarnings,
    repoOwner,
    repoRoot,
    resolveProjectNumber,
    warnings,
} from './lib.mjs';

function parseArgs(argv) {
    const positional = argv.filter((a) => !a.startsWith('--'));
    const number = Number(positional[0]);
    if (!Number.isInteger(number) || number <= 0) {
        process.stderr.write('usage: claim.mjs <issue-number> [--no-status] [--status <value>]\n');
        process.exit(1);
    }
    const noStatus = argv.includes('--no-status');
    const i = argv.indexOf('--status');
    const status = i !== -1 ? argv[i + 1] : null;
    return {number, noStatus, status};
}

/**
 * Project Status 를 옮긴다. 실패해도 선점 자체를 되돌리지는 않는다 —
 * 담당자가 걸린 것만으로도 다른 세션은 이 이슈를 후보에서 뺀다.
 */
function moveStatus(owner, projectNumber, issueNumber, config, wanted) {
    const project = ghJson(['project', 'view', String(projectNumber), '--owner', owner, '--format', 'json']);
    const projectId = project?.id;
    if (!projectId) {
        warnings.push('Could not read the Project id, so the status was left alone');
        return null;
    }

    const fields = ghJson(['project', 'field-list', String(projectNumber), '--owner', owner, '--format', 'json']);
    const field = (fields?.fields || []).find((f) => f.name?.toLowerCase() === config.statusField.toLowerCase());
    if (!field) {
        warnings.push(`The Project has no "${config.statusField}" field, so the status was left alone`);
        return null;
    }
    const option = (field.options || []).find((o) => o.name?.toLowerCase() === wanted.toLowerCase());
    if (!option) {
        const names = (field.options || []).map((o) => o.name).join(', ');
        warnings.push(`"${config.statusField}" has no "${wanted}" option (available: ${names})`);
        return null;
    }

    const items = ghJson([
        'project',
        'item-list',
        String(projectNumber),
        '--owner',
        owner,
        '--limit',
        '500',
        '--format',
        'json',
    ]);
    const item = (items?.items || []).find((it) => it?.content?.number === issueNumber);
    if (!item) {
        warnings.push(`Issue #${issueNumber} is not on the Project, so the status was left alone`);
        return null;
    }

    const edited = ghJson([
        'project',
        'item-edit',
        '--id',
        item.id,
        '--project-id',
        projectId,
        '--field-id',
        field.id,
        '--single-select-option-id',
        option.id,
        '--format',
        'json',
    ]);
    return edited ? wanted : null;
}

function main() {
    const {number, noStatus, status} = parseArgs(process.argv.slice(2));
    const config = loadConfig(repoRoot());
    const me = currentUser();
    if (!me) {
        process.stderr.write('Cannot tell who you are. Run gh auth login first.\n');
        process.exit(1);
    }

    const assigned = ghText(['issue', 'edit', String(number), '--add-assignee', '@me']);
    if (assigned === null) {
        process.stderr.write(`Could not assign yourself to issue #${number}.\n`);
        printWarnings();
        process.exit(1);
    }

    // 되읽기. 여기가 락을 대신하는 자리다.
    const after = ghJson(['issue', 'view', String(number), '--json', 'assignees,title']);
    const logins = (after?.assignees || []).map((a) => a.login);
    const others = logins.filter((l) => l !== me);

    if (!logins.includes(me)) {
        process.stdout.write(`Claim failed: #${number} is assigned to ${logins.join(', ') || 'nobody'}. Move on to the next candidate.\n`);
        printWarnings();
        process.exit(1);
    }
    if (others.length > 0) {
        // 같은 순간에 다른 사람도 집었다. 늦게 온 쪽이 물러나는 편이 안전하다.
        process.stdout.write(
            `Claim contended: ${others.join(', ')} is also assigned to #${number}. ` +
                `Drop your assignment and move on — gh issue edit ${number} --remove-assignee @me\n`
        );
        printWarnings();
        process.exit(1);
    }

    let moved = null;
    const wanted = status || (noStatus ? null : claimStatusFor(config));
    if (wanted) {
        const owner = repoOwner();
        const projectNumber = resolveProjectNumber(owner, config);
        if (owner && projectNumber != null) moved = moveStatus(owner, projectNumber, number, config, wanted);
    }

    process.stdout.write(`Claimed #${number} ${after?.title || ''}\n`);
    process.stdout.write(`  assignee=${me}${moved ? `, ${config.statusField}=${moved}` : ''}\n`);
    // 로컬 워크트리는 내 머신에서만 보이고, 그마저 어느 이슈인지는 PR 이 있어야 안다.
    // draft PR 을 먼저 열면 그 순간부터 점유가 모두에게 — 나중의 나에게도 — 보인다.
    process.stdout.write('  Open a draft PR as you start, so the claim is visible to everyone.\n');
    printWarnings();
}

main();
