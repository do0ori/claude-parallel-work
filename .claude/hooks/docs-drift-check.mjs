#!/usr/bin/env node
/**
 * 커밋 직전에 "이 변경이 문서를 낡게 만드는가"를 확인시키는 Claude Code PreToolUse 훅.
 *
 * 이 저장소는 같은 동작을 네 곳이 설명한다 — SKILL.md, README.md, README.ko.md,
 * 그리고 commands/. 하나만 고치면 나머지가 조용히 틀린 말을 하게 된다. 실제로
 * 순위표에서 1 순위가 빠지고, 하드 제외 조건이 잘못 적히고, 선점 순서가 반대로
 * 적힌 채로 지나간 적이 있다. 셋 다 읽히기는 하는 문장이라 눈에 띄지 않았다.
 *
 * 자동으로 문서를 고치지는 않는다. 무엇이 어긋났는지는 사람이나 에이전트가 읽고
 * 판단해야 한다.
 *
 * 통과 조건 (위에서부터, 하나라도 걸리면 즉시 통과)
 *   1. git commit 이 아닌 명령
 *   2. 스테이징된 파일이 어느 매핑에도 걸리지 않음
 *   3. 걸린 문서가 이미 함께 스테이징됨
 *   4. 지금 스테이징 상태를 --ack 로 검토 표시함
 *
 * 사용
 *   .claude/settings.json 의 PreToolUse(Bash) 훅으로 등록되어 자동 실행된다.
 *   문서를 고칠 필요가 없다고 판단했으면:  node .claude/hooks/docs-drift-check.mjs --ack
 */

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

/** 경로 → 함께 확인해야 할 문서와 절. */
const RULES = [
    {
        pattern: /^skills\/picking-parallel-work\/scripts\/survey\.mjs$/,
        docs: [
            ['skills/picking-parallel-work/SKILL.md', 'ranking table and the hard-exclusion paragraph'],
            ['README.md', '"How it decides" and "Ranking"'],
            ['README.ko.md', '"어떻게 겹침을 판단하나" and "순위"'],
        ],
    },
    {
        pattern: /^skills\/picking-parallel-work\/scripts\/lib\.mjs$/,
        docs: [
            ['skills/picking-parallel-work/SKILL.md', '"설정하기"'],
            ['README.md', 'the "Configuration" key table and the example JSON'],
            ['README.ko.md', 'the "설정" key table and the example JSON'],
        ],
    },
    {
        pattern: /^skills\/picking-parallel-work\/scripts\/claim\.mjs$/,
        docs: [
            ['skills/picking-parallel-work/SKILL.md', 'step 3, 선점한다'],
            ['README.md', '"Claiming"'],
            ['README.ko.md', '"선점"'],
        ],
    },
    {
        pattern: /^skills\/picking-parallel-work\/scripts\/launch\.mjs$/,
        docs: [
            ['skills/picking-parallel-work/SKILL.md', 'step 4, 새 세션을 연다'],
            ['README.md', '"Opening the new session" and the .worktreeinclude note'],
            ['README.ko.md', '"새 세션을 여는 방식" and the .worktreeinclude note'],
        ],
    },
    {
        pattern: /^commands\/.*\.md$/,
        docs: [
            ['README.md', '"Usage"'],
            ['README.ko.md', '"쓰는 법"'],
        ],
    },
];

/** 이 파일들이 바뀌면 플러그인 내용이 바뀐 것이므로 버전도 올라야 한다. */
const VERSIONED = /^(skills|commands)\//;
const MANIFEST = '.claude-plugin/plugin.json';

const GIT_COMMIT = /(^|[;&|(]|&&|\|\|)\s*git\s+((-{1,2}[^\s]*|[^\s]+=[^\s]+)\s+)*commit(\s|$)/;

function git(...args) {
    return execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}

/** 스테이징된 트리의 해시. 파일이 하나라도 더 바뀌면 값이 달라진다. */
function stagedTreeHash() {
    return git('write-tree');
}

function ackFilePath() {
    // .git 안에 두어 커밋되지 않게 하고, 워크트리마다 따로 관리되게 한다.
    return git('rev-parse', '--git-path', 'parallel-work-docs-ack');
}

function readStdin() {
    try {
        return fs.readFileSync(0, 'utf8');
    } catch {
        return '';
    }
}

function ack() {
    const hash = stagedTreeHash();
    fs.writeFileSync(ackFilePath(), hash + '\n', 'utf8');
    console.log(`Marked as reviewed (staged tree ${hash.slice(0, 12)}). Commit this exact state and it passes.`);
    console.log('Change any file and the mark is void; you will be asked again.');
}

function main() {
    if (process.argv.includes('--ack')) {
        ack();
        return 0;
    }

    let payload;
    try {
        payload = JSON.parse(readStdin());
    } catch {
        return 0; // 훅 입력을 못 읽으면 막지 않는다. 훅 때문에 작업이 멈추면 안 된다.
    }

    if (payload.tool_name !== 'Bash') return 0;
    if (!GIT_COMMIT.test(payload.tool_input?.command ?? '')) return 0;

    let staged;
    let treeHash;
    try {
        staged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
        treeHash = stagedTreeHash();
    } catch {
        return 0; // 병합 충돌 등 비정상 인덱스 상태에서는 판단하지 않는다.
    }
    if (staged.length === 0) return 0;

    /** 문서 → 확인할 절과, 그 문서를 지목하게 만든 파일 */
    const needed = new Map();
    for (const file of staged) {
        for (const rule of RULES) {
            if (!rule.pattern.test(file)) continue;
            for (const [doc, section] of rule.docs) {
                if (!needed.has(doc)) needed.set(doc, {sections: new Set(), causes: new Set()});
                needed.get(doc).sections.add(section);
                needed.get(doc).causes.add(file);
            }
        }
    }
    for (const doc of [...needed.keys()]) {
        if (staged.includes(doc)) needed.delete(doc);
    }

    // 버전은 문서가 아니라 사실이므로 --ack 로 넘길 수 없다. 별도로 본다.
    const versionMissing = staged.some((f) => VERSIONED.test(f)) && !staged.includes(MANIFEST);

    if (needed.size === 0 && !versionMissing) return 0;

    if (needed.size > 0) {
        try {
            if (fs.readFileSync(ackFilePath(), 'utf8').trim() === treeHash && !versionMissing) return 0;
        } catch {
            // 표시 없음 — 계속 진행한다.
        }
    }

    const lines = ['Commit stopped.', ''];

    if (versionMissing) {
        lines.push(`  ${MANIFEST}`);
        lines.push('    Plugin content changed but the version was not bumped.');
        lines.push('    Installed copies update by version; without a bump nobody gets this change.');
        lines.push('');
    }

    for (const [doc, {sections, causes}] of needed) {
        lines.push(`  ${doc}`);
        for (const s of sections) lines.push(`    check: ${s}`);
        for (const c of causes) lines.push(`    because: ${c}`);
        lines.push('');
    }

    if (needed.size > 0) {
        lines.push('Do one of these:');
        lines.push('  1. The docs are actually stale -> fix them, git add, commit again');
        lines.push('  2. You read them and nothing needs changing -> node .claude/hooks/docs-drift-check.mjs --ack');
        lines.push('');
        lines.push('Do not skip to 2 without opening the documents. Then this hook may as well not exist.');
    }

    process.stderr.write(lines.join('\n') + '\n');
    return 2; // exit 2 → 도구 호출을 막고 stderr 를 Claude 에게 전달한다.
}

process.exit(main());
