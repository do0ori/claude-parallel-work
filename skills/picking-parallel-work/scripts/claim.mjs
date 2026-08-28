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

import {ghJson, ghText, loadConfig, repoRoot, repoOwner, currentUser, resolveProjectNumber, warnings, printWarnings} from './lib.mjs';

function parseArgs(argv) {
    const positional = argv.filter((a) => !a.startsWith('--'));
    const number = Number(positional[0]);
    if (!Number.isInteger(number) || number <= 0) {
        process.stderr.write('사용법: claim.mjs <이슈번호> [--no-status] [--status <값>]\n');
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
        warnings.push('Project ID 를 읽지 못해 Status 를 옮기지 못했다');
        return null;
    }

    const fields = ghJson(['project', 'field-list', String(projectNumber), '--owner', owner, '--format', 'json']);
    const field = (fields?.fields || []).find((f) => f.name?.toLowerCase() === config.statusField.toLowerCase());
    if (!field) {
        warnings.push(`Project 에 "${config.statusField}" 필드가 없어 Status 를 옮기지 못했다`);
        return null;
    }
    const option = (field.options || []).find((o) => o.name?.toLowerCase() === wanted.toLowerCase());
    if (!option) {
        const names = (field.options || []).map((o) => o.name).join(', ');
        warnings.push(`"${config.statusField}" 에 "${wanted}" 옵션이 없다 (있는 값: ${names})`);
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
        warnings.push(`이슈 #${issueNumber} 가 Project 에 올라 있지 않아 Status 를 옮기지 못했다`);
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
        process.stderr.write('gh 로 인증된 사용자를 알 수 없다. gh auth login 을 먼저 하라.\n');
        process.exit(1);
    }

    const assigned = ghText(['issue', 'edit', String(number), '--add-assignee', '@me']);
    if (assigned === null) {
        process.stderr.write(`이슈 #${number} 에 담당자를 걸지 못했다.\n`);
        printWarnings();
        process.exit(1);
    }

    // 되읽기. 여기가 락을 대신하는 자리다.
    const after = ghJson(['issue', 'view', String(number), '--json', 'assignees,title']);
    const logins = (after?.assignees || []).map((a) => a.login);
    const others = logins.filter((l) => l !== me);

    if (!logins.includes(me)) {
        process.stdout.write(`선점 실패: #${number} 담당자가 ${logins.join(', ') || '비어 있음'} 이다. 다음 후보로 넘어가라.\n`);
        printWarnings();
        process.exit(1);
    }
    if (others.length > 0) {
        // 같은 순간에 다른 사람도 집었다. 늦게 온 쪽이 물러나는 편이 안전하다.
        process.stdout.write(
            `선점 경합: #${number} 에 ${others.join(', ')} 도 함께 올라와 있다. ` +
                `내 담당을 떼고 다음 후보로 넘어가라 — gh issue edit ${number} --remove-assignee @me\n`
        );
        printWarnings();
        process.exit(1);
    }

    let moved = null;
    const wanted = status || (noStatus ? null : config.claimStatus);
    if (wanted) {
        const owner = repoOwner();
        const projectNumber = resolveProjectNumber(owner, config);
        if (owner && projectNumber != null) moved = moveStatus(owner, projectNumber, number, config, wanted);
    }

    process.stdout.write(`선점 완료: #${number} ${after?.title || ''}\n`);
    process.stdout.write(`  assignee=${me}${moved ? `, ${config.statusField}=${moved}` : ''}\n`);
    printWarnings();
}

main();
