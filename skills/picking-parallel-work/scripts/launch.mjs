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

import {loadConfig, repoRoot} from './lib.mjs';

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
        fail(`워크트리 이름 "${name ?? ''}" 을 쓸 수 없다. 문자·숫자·점·밑줄·하이픈·슬래시만 된다.`);
    }
    if (!Number.isInteger(issue) || issue <= 0) {
        fail(`이슈 번호가 잘못됐다: "${rawIssue ?? ''}"`);
    }

    let how = null;
    if (argv.includes('--print')) how = 'print';
    if (argv.includes('--session')) how = 'session';
    return {name, issue, how};
}

function fail(message) {
    process.stderr.write(`${message}\n사용법: launch.mjs <워크트리이름> <이슈번호> [--print|--session]\n`);
    process.exit(1);
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

    const body = isWindows
        ? ['@echo off', `cd /d "${root}" || exit /b 1`, `claude --worktree "${name}" "/work-issue ${issue}"`, ''].join(
              '\r\n'
          )
        : ['#!/bin/sh', `cd '${root.replace(/'/g, `'\\''`)}' || exit 1`, `exec claude --worktree '${name}' '/work-issue ${issue}'`, ''].join('\n');

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

function main() {
    const {name, issue, how} = parseArgs(process.argv.slice(2));
    const root = repoRoot();
    const config = loadConfig(root);
    const mode = how || config.launch || 'print';
    const command = printableCommand(name, issue);

    if (mode !== 'session') {
        process.stdout.write(`새 터미널에 붙여넣으세요:\n  ${command}\n`);
        return;
    }

    const script = writeLaunchScript(root, name, issue);
    const terminal = terminalFor(script, root, config);

    if (process.argv.includes('--dry-run')) {
        process.stdout.write(`플랫폼: ${process.platform}\n`);
        process.stdout.write(`실행할 창: ${terminal ? [terminal.file, ...terminal.args].join(' ') : '(찾지 못함)'}\n`);
        process.stdout.write(`스크립트: ${script}\n---\n${fs.readFileSync(script, 'utf8')}---\n`);
        fs.unlinkSync(script);
        return;
    }

    if (!terminal) {
        // 창을 못 여는 것은 실패지만, 사람이 이어서 할 수 있으면 막다른 길은 아니다
        process.stdout.write(
            `이 환경에서 새 창을 여는 방법을 찾지 못했습니다. 아래를 붙여넣으세요:\n  ${command}\n` +
                `\n설정의 terminalCommand 로 직접 지정할 수 있습니다. {script} 가 실행할 파일로 바뀝니다.\n`
        );
        process.exitCode = 1;
        return;
    }

    const child = spawn(terminal.file, terminal.args, {detached: true, stdio: 'ignore'});
    child.on('error', (err) => {
        process.stderr.write(`${terminal.file} 실행 실패 — ${err.message}\n아래를 붙여넣으세요:\n  ${command}\n`);
        process.exitCode = 1;
    });
    child.unref();

    process.stdout.write(`새 세션을 열었습니다 — 워크트리 ${name}, 이슈 #${issue}\n`);
    process.stdout.write(`  ${terminal.file} 로 창을 띄웠습니다. 그 창에서 세션이 시작됩니다.\n`);
}

main();
