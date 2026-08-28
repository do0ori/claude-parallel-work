#!/usr/bin/env node
/**
 * 새 세션을 연다 — 붙여넣을 명령을 출력하거나, 새 창에서 바로 띄운다.
 *
 * 두 방식이 있고 설정의 launch 가 고른다.
 *   print    (기본) 명령 한 줄을 출력한다. 사람이 붙여넣는다.
 *   session  새 창을 열어 그 안에서 세션을 시작한다.
 *
 * print 가 기본인 이유는 어느 터미널·어느 OS 에서든 확실히 동작하고, 띄우기 전에
 * 선택을 한 번 볼 수 있어서다. session 은 편하지만 창을 여는 방법이 OS 마다
 * 다르고 실패할 여지가 있다.
 *
 * 새 창을 여는 방법
 *   중간에 셸 스크립트를 하나 만들고 터미널에게 그것을 실행시킨다. 명령을
 *   터미널 인자로 직접 넘기면 OS 마다 다른 따옴표 규칙에 걸려 조용히 깨진다.
 *   스크립트를 거치면 그 문제가 사라진다.
 *
 *   windows  Windows Terminal(wt) 이 있으면 새 탭, 없으면 새 cmd 창
 *   macOS    open -a Terminal
 *   linux    x-terminal-emulator / gnome-terminal / konsole / xterm 중 있는 것
 *
 * 사용
 *   node <플러그인>/.../launch.mjs <워크트리이름> <이슈번호> [--print|--session]
 */

import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {findUncoveredLocalConfig, loadConfig, repoRoot, WORKTREE_INCLUDE} from './lib.mjs';

/**
 * 워크트리 이름에 허용하는 글자.
 *
 * 이 값이 생성되는 스크립트 안으로 들어가므로 느슨하게 받으면 안 된다.
 * Claude Code 가 워크트리 이름에 허용하는 범위(문자·숫자·점·밑줄·하이픈과
 * 구분자로서의 슬래시)와 같게 맞췄다.
 */
const SAFE_NAME = /^[A-Za-z0-9._/-]{1,64}$/;

function parseArgs(argv) {
    const positional = argv.filter((a) => !a.startsWith('--'));
    const [name, rawIssue] = positional;
    const issue = Number(rawIssue);

    if (!name || !SAFE_NAME.test(name)) {
        fail(`Cannot use the worktree name "${name ?? ''}". Letters, digits, dot, underscore, hyphen and slash only.`);
    }
    if (!Number.isInteger(issue) || issue <= 0) {
        fail(`Bad issue number: "${rawIssue ?? ''}"`);
    }

    let how = null;
    if (argv.includes('--print')) how = 'print';
    if (argv.includes('--session')) how = 'session';
    return {name, issue, how};
}

function fail(message) {
    process.stderr.write(`${message}\nusage: launch.mjs <worktree-name> <issue-number> [--print|--session]\n`);
    process.exit(1);
}

/**
 * 이 프로세스가 물려받은 Claude 세션 표식들.
 *
 * 이 스크립트는 대개 Claude 세션 안에서 실행된다. 그러면 자식 프로세스가
 * CLAUDE_CODE_CHILD_SESSION 같은 표식을 그대로 물려받고, 새로 뜬 세션이 자기를
 * "누군가의 자식 세션" 으로 여긴다. 그 상태에서는 플러그인이 로드되지 않아
 * /work-issue 가 "Unknown command" 로 끝난다. 실제로 그렇게 한 번 죽었다.
 *
 * ANTHROPIC_* 는 건드리지 않는다. 인증에 쓰이는 값이라 물려받아야 한다.
 */
function inheritedClaudeVars() {
    return Object.keys(process.env).filter((k) => /^CLAUDE/i.test(k));
}

/** Claude 표식을 뺀 환경. 새 세션은 부모를 몰라야 한다. */
function cleanEnv() {
    const env = {...process.env};
    for (const k of inheritedClaudeVars()) delete env[k];
    return env;
}

function has(command) {
    try {
        execFileSync(process.platform === 'win32' ? 'where' : 'command', [command], {
            stdio: 'ignore',
            shell: process.platform !== 'win32',
        });
        return true;
    } catch {
        return false;
    }
}

/** 붙여넣기 좋은 한 줄. */
function printableCommand(name, issue) {
    return `claude --worktree ${name} "/work-issue ${issue}"`;
}

/**
 * 새 창이 실행할 스크립트를 만든다.
 *
 * 인자는 이미 SAFE_NAME 과 정수로 걸러졌고, 여기서 다시 셸 문법에 맞게 감싼다.
 */
function writeLaunchScript(root, name, issue) {
    const slug = name.replace(/[^A-Za-z0-9]/g, '-');
    const isWindows = process.platform === 'win32';
    const file = path.join(os.tmpdir(), `parallel-work-${slug}-${process.pid}.${isWindows ? 'cmd' : 'sh'}`);

    // 창을 여는 경로가 환경을 어디서 물려줄지 알 수 없으므로, 실행 직전에 한 번 더 지운다.
    const vars = inheritedClaudeVars();
    const body = isWindows
        ? [
              '@echo off',
              ...vars.map((k) => `set "${k}="`),
              `cd /d "${root}" || exit /b 1`,
              `claude --worktree "${name}" "/work-issue ${issue}"`,
              '',
          ].join('\r\n')
        : [
              '#!/bin/sh',
              ...vars.map((k) => `unset ${k}`),
              `cd '${root.replace(/'/g, `'\\''`)}' || exit 1`,
              `exec claude --worktree '${name}' '/work-issue ${issue}'`,
              '',
          ].join('\n');

    fs.writeFileSync(file, body);
    if (!isWindows) fs.chmodSync(file, 0o755);
    return file;
}

/** 이 OS 에서 새 창을 여는 명령. 못 찾으면 null. */
function terminalFor(script, root, config) {
    if (Array.isArray(config.terminalCommand) && config.terminalCommand.length > 0) {
        const [file, ...rest] = config.terminalCommand.map((a) => a.replace('{script}', script).replace('{dir}', root));
        return {file, args: rest};
    }

    if (process.platform === 'win32') {
        if (has('wt')) return {file: 'wt', args: ['-w', '0', 'nt', '-d', root, 'cmd', '/k', script]};
        return {file: 'cmd', args: ['/c', 'start', '', 'cmd', '/k', script]};
    }
    if (process.platform === 'darwin') {
        return {file: 'open', args: ['-a', 'Terminal', script]};
    }
    for (const term of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm']) {
        if (!has(term)) continue;
        // gnome-terminal 은 -e 를 버렸고 -- 뒤를 실행한다
        return term === 'gnome-terminal' ? {file: term, args: ['--', script]} : {file: term, args: ['-e', script]};
    }
    return null;
}

/**
 * 새 워크트리에 따라가야 할 로컬 설정을 .worktreeinclude 에 채운다.
 *
 * 사람에게 "이걸 추가하세요" 라고 시키지 않는다. 워크트리가 만들어지기 직전인
 * 지금이 채워 넣을 마지막 순간이고, 빠지면 새 세션이 빌드부터 실패한다.
 *
 * 무엇을 더했는지는 반드시 보고한다. 커밋되는 파일을 말없이 고치지 않는다.
 */
function ensureLocalConfigCarried(root) {
    const missing = findUncoveredLocalConfig(root);
    if (missing.length === 0) return [];

    const file = path.join(root, WORKTREE_INCLUDE);
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const header = existing
        ? ''
        : '# Gitignored local config that new worktrees need.\n' +
          '# Claude Code copies these in when it creates a worktree.\n\n';
    const gap = existing && !existing.endsWith('\n') ? '\n' : '';

    fs.writeFileSync(file, existing + gap + header + missing.join('\n') + '\n');
    return missing;
}

function main() {
    const {name, issue, how} = parseArgs(process.argv.slice(2));
    const root = repoRoot();
    const config = loadConfig(root);
    const mode = how || config.launch || 'print';
    const command = printableCommand(name, issue);
    const carried = ensureLocalConfigCarried(root);

    if (carried.length > 0) {
        process.stdout.write(
            `Added to ${WORKTREE_INCLUDE} so the new worktree gets them: ${carried.join(', ')}\n`
        );
    }

    if (mode !== 'session') {
        process.stdout.write(`Paste this into a new terminal:\n  ${command}\n`);
        return;
    }

    const script = writeLaunchScript(root, name, issue);
    const terminal = terminalFor(script, root, config);

    if (process.argv.includes('--dry-run')) {
        process.stdout.write(`platform: ${process.platform}\n`);
        process.stdout.write(`terminal: ${terminal ? [terminal.file, ...terminal.args].join(' ') : '(none found)'}\n`);
        process.stdout.write(`script: ${script}\n---\n${fs.readFileSync(script, 'utf8')}---\n`);
        fs.unlinkSync(script);
        return;
    }

    if (!terminal) {
        // 창을 못 여는 것은 실패지만, 사람이 이어서 할 수 있으면 막다른 길은 아니다
        process.stdout.write(
            `Could not find a way to open a window here. Paste this instead:\n  ${command}\n` +
                `\nYou can set terminalCommand in the config. {script} is replaced with the file to run.\n`
        );
        process.exitCode = 1;
        return;
    }

    const child = spawn(terminal.file, terminal.args, {detached: true, stdio: 'ignore', env: cleanEnv()});
    child.on('error', (err) => {
        process.stderr.write(`Could not run ${terminal.file} — ${err.message}\nPaste this instead:\n  ${command}\n`);
        process.exitCode = 1;
    });
    child.unref();

    process.stdout.write(`Opened a new session — worktree ${name}, issue #${issue}\n`);
    process.stdout.write(
        `  Opened via ${terminal.file} — this is a separate window, not a tab in the terminal you are reading.\n` +
            `  Look for a window titled with the worktree name; on Windows check the taskbar.\n`
    );
}

main();
