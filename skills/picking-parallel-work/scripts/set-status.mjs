#!/usr/bin/env node
/**
 * 이슈의 Project Status 를 옮긴다.
 *
 * 선점할 때는 claim.mjs 가 알아서 옮기지만, 작업이 끝난 뒤 Done 으로 내리는 것은
 * 아무도 하지 않아 보드가 조용히 낡는다. 머지된 지 오래인 이슈가 Todo 나
 * In Progress 로 남아 있으면 다음 사람이 후보 목록을 믿지 못하게 된다.
 *
 * 사용
 *   node <플러그인>/.../set-status.mjs <이슈번호> <Status 값>
 *   node ... set-status.mjs 3 Done
 *
 * 종료 코드
 *   0  옮김
 *   1  못 옮김 (이유는 출력에 있다)
 */

import {loadConfig, printWarnings, repoRoot, setProjectStatus} from './lib.mjs';

function main() {
    const [rawNumber, wanted] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    const number = Number(rawNumber);

    if (!Number.isInteger(number) || number <= 0 || !wanted) {
        process.stderr.write('usage: set-status.mjs <issue-number> <status>\n');
        process.exit(1);
    }

    const config = loadConfig(repoRoot());
    const moved = setProjectStatus(number, config, wanted);

    if (!moved) {
        process.stdout.write(`Could not set ${config.statusField} on #${number}.\n`);
        printWarnings();
        process.exit(1);
    }

    process.stdout.write(`#${number}  ${config.statusField}=${moved}\n`);
    printWarnings();
}

main();
