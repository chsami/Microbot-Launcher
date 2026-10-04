const MIN_JAVA_MAJOR = 11;
const RECOMMENDED_JAVA_MAJOR = 17;
const ZGC_MIN_JAVA_MAJOR = 15;
const MAX_32_BIT_HEAP_MB = 1024;
const PROBE_ARGS = ['-XshowSettings:properties', '-version'];
const ZGC_ONLY_FLAGS = [
    '-XX:+UseZGC',
    '-XX:SoftMaxHeapSize=',
    '-XX:+ZUncommit',
    '-XX:ZUncommitDelay='
];
const DEFAULT_MAX_LINES = 20;
const DEFAULT_MAX_CHARS = 2000;

function parseJavaMajor(version) {
    if (typeof version !== 'string') return null;
    const trimmed = version.trim();
    const legacy = trimmed.match(/^1\.(\d+)(?:[._+-]|$)/);
    if (legacy) return Number(legacy[1]);
    const modern = trimmed.match(/^(\d+)(?:[.+_-]|$)/);
    if (!modern) return null;
    const major = Number(modern[1]);
    return Number.isInteger(major) && major > 0 ? major : null;
}

function parseJavaSettings(output) {
    const text = typeof output === 'string' ? output : '';
    const props = {};
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s{4}([\w.]+) = (.*)$/);
        if (match) props[match[1]] = match[2].trim();
    }

    const banner = text.match(/(?:java|openjdk) version "([^"]+)"/i);
    const version = props['java.version'] || (banner ? banner[1] : null);
    let dataModel = props['sun.arch.data.model']
        ? Number(props['sun.arch.data.model'])
        : null;
    if (!dataModel) {
        if (/64-Bit/i.test(text)) dataModel = 64;
        else if (/(Client|Server) VM/i.test(text)) dataModel = 32;
    }

    return {
        version,
        major: parseJavaMajor(version),
        vendor: props['java.vendor'] || null,
        vmName: props['java.vm.name'] || null,
        home: props['java.home'] || null,
        osArch: props['os.arch'] || null,
        dataModel
    };
}

function heapMbFromArgs(args) {
    let heapMb = null;
    for (const arg of args || []) {
        const match = typeof arg === 'string' && arg.match(/^-Xmx(\d+(?:\.\d+)?)([kmgt]?)$/i);
        if (!match) continue;
        const amount = Number(match[1]);
        const unit = match[2].toLowerCase();
        const factor = { '': 1 / (1024 * 1024), k: 1 / 1024, m: 1, g: 1024, t: 1024 * 1024 }[unit];
        heapMb = amount * factor;
    }
    return heapMb;
}

function describeRuntime(info) {
    if (!info) return 'unknown Java runtime';
    const parts = [`Java ${info.version || 'unknown version'}`];
    if (info.vendor) parts.push(info.vendor);
    const arch = [info.osArch, info.dataModel ? `${info.dataModel}-bit` : null]
        .filter(Boolean)
        .join(', ');
    if (arch) parts.push(`(${arch})`);
    return parts.join(' ');
}

function evaluateRuntime(info, { heapMb } = {}) {
    const problems = [];
    if (!info || !info.major) {
        problems.push({
            code: 'unknown-version',
            message: 'The Java version could not be determined.',
            recovery: `Install Java ${RECOMMENDED_JAVA_MAJOR} (64-bit) and make it the default "java" on your PATH.`
        });
    } else if (info.major < MIN_JAVA_MAJOR) {
        problems.push({
            code: 'too-old',
            message: `Java ${info.major} is too old; Microbot requires Java ${MIN_JAVA_MAJOR} or newer.`,
            recovery: `Install Java ${RECOMMENDED_JAVA_MAJOR} (64-bit) and make it the default "java" on your PATH.`
        });
    }
    if (info && info.dataModel === 32 && heapMb && heapMb > MAX_32_BIT_HEAP_MB) {
        problems.push({
            code: '32-bit-heap',
            message: `32-bit Java cannot reserve the requested ${Math.round(heapMb)} MB of client memory.`,
            recovery: `Install 64-bit Java ${RECOMMENDED_JAVA_MAJOR}, or lower the client RAM to ${MAX_32_BIT_HEAP_MB} MB or less.`
        });
    }
    return { compatible: problems.length === 0, problems };
}

function supportedVmArgs(major, args) {
    if (major && major >= ZGC_MIN_JAVA_MAJOR) return [...args];
    return args.filter((arg) => !ZGC_ONLY_FLAGS.some((zgc) => arg.startsWith(zgc)));
}

function redactText(text, { homeDir } = {}) {
    if (typeof text !== 'string') return '';
    let result = text
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
        .replace(/(-proxy=)\S+/g, '$1***')
        .replace(/(-profile=)\S+/g, '$1***')
        .replace(/\b(JX_[A-Z_]+|[\w.-]*(?:password|passwd|token|secret|session(?:id)?|credential)s?)(\s*[=:]\s*)\S+/gi, '$1$2***')
        .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '***@***');
    if (homeDir && homeDir.length > 1) {
        result = result.split(homeDir).join('~');
    }
    return result;
}

function boundedTail(text, { maxLines = DEFAULT_MAX_LINES, maxChars = DEFAULT_MAX_CHARS } = {}) {
    if (typeof text !== 'string' || text.trim() === '') return '';
    const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
    let tail = lines.slice(-maxLines).join('\n');
    let truncated = lines.length > maxLines;
    if (tail.length > maxChars) {
        tail = tail.slice(tail.length - maxChars);
        truncated = true;
    }
    return truncated ? `…\n${tail}` : tail;
}

function classifyProbeFailure({ error, code, timedOut, stderr } = {}) {
    if (error && error.code === 'ENOENT') {
        return {
            kind: 'missing-java',
            title: 'Java Not Found',
            message: 'No "java" command was found on your PATH.',
            recovery: `Install Java ${RECOMMENDED_JAVA_MAJOR} (64-bit), then restart the launcher.`,
            offerDownload: true
        };
    }
    if (timedOut) {
        return {
            kind: 'incompatible-java',
            title: 'Java Did Not Respond',
            message: 'The "java" command did not report its version in time.',
            recovery: `Check that Java works by running "java -version" in a terminal, or reinstall Java ${RECOMMENDED_JAVA_MAJOR} (64-bit).`,
            offerDownload: true
        };
    }
    if (error) {
        return {
            kind: 'process-launch',
            title: 'Java Could Not Be Started',
            message: `The "java" command could not be started: ${error.message}`,
            recovery: 'Check that Java is installed correctly and that security software is not blocking it.',
            offerDownload: true
        };
    }
    return {
        kind: 'incompatible-java',
        title: 'Java Failed To Start',
        message: `The "java" command exited with code ${code} while reporting its version.`,
        recovery: `Reinstall Java ${RECOMMENDED_JAVA_MAJOR} (64-bit) and make it the default "java" on your PATH.`,
        offerDownload: true,
        stderr
    };
}

const VM_FAILURE_HINTS = [
    {
        pattern: /Could not reserve enough space|insufficient memory for the Java Runtime|Initial heap size set to a larger value|Invalid (?:maximum|initial) heap size/i,
        recovery: 'Lower the client RAM setting, or install 64-bit Java if you are using 32-bit Java.'
    },
    {
        pattern: /UnsupportedClassVersionError|has been compiled by a more recent version/i,
        recovery: `Install Java ${RECOMMENDED_JAVA_MAJOR} (64-bit); the selected Java is too old for this client.`,
        offerDownload: true
    },
    {
        pattern: /Unrecognized VM option|must be enabled via -XX:\+Unlock|unlock option must precede|not supported on this platform/i,
        recovery: `Install Java ${RECOMMENDED_JAVA_MAJOR} (64-bit); the selected Java rejected a launcher option.`,
        offerDownload: true
    },
    {
        pattern: /Unable to access jarfile|Invalid or corrupt jarfile|Error: Invalid or corrupt/i,
        recovery: 'The client file is missing or damaged. Delete it from the .microbot folder and launch again to download it.'
    }
];

const VM_FAILURE_PATTERN = /Could not create the Java Virtual Machine|Error occurred during initialization of VM|A fatal exception has occurred|Unable to access jarfile|Invalid or corrupt jarfile|UnsupportedClassVersionError|insufficient memory for the Java Runtime/i;

function classifyLaunchFailure({ error, code, signal, stderr } = {}) {
    if (error) {
        if (error.code === 'ENOENT') {
            return {
                kind: 'missing-java',
                title: 'Java Not Found',
                message: `The Java executable could not be found: ${error.message}`,
                recovery: `Install Java ${RECOMMENDED_JAVA_MAJOR} (64-bit), then restart the launcher.`,
                offerDownload: true
            };
        }
        return {
            kind: 'process-launch',
            title: 'Client Could Not Be Started',
            message: `Java could not be started: ${error.message}`,
            recovery: 'Check that Java is installed correctly and that security software is not blocking it.',
            offerDownload: false
        };
    }

    const output = typeof stderr === 'string' ? stderr : '';
    const hint = VM_FAILURE_HINTS.find((h) => h.pattern.test(output));
    const exitText = code !== null && code !== undefined ? `exit code ${code}` : `signal ${signal}`;
    if (VM_FAILURE_PATTERN.test(output) || hint) {
        return {
            kind: 'vm-failure',
            title: 'Java Could Not Start The Client',
            message: `The Java virtual machine failed to start (${exitText}).`,
            recovery: hint
                ? hint.recovery
                : `Install Java ${RECOMMENDED_JAVA_MAJOR} (64-bit), or lower the client RAM setting, then try again.`,
            offerDownload: Boolean(hint && hint.offerDownload) || !hint
        };
    }
    return {
        kind: 'client-startup',
        title: 'Client Closed During Startup',
        message: `The client exited during startup (${exitText}).`,
        recovery: 'Try launching again. If it keeps happening, copy the details below and share them when asking for help.',
        offerDownload: false
    };
}

function javaDownloadUrl(platform, arch) {
    const javaArch = arch === 'arm64' ? 'aarch64' : 'x64';
    const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[platform];
    if (!os) return 'https://adoptium.net/temurin/';
    return `https://adoptium.net/temurin/releases/?os=${os}&arch=${javaArch}&package=jdk&version=${RECOMMENDED_JAVA_MAJOR}&mode=filter`;
}

function launcherExecutable(info, platform, existsSync) {
    const name = platform === 'win32' ? 'javaw' : 'java';
    if (info && info.home) {
        const sep = platform === 'win32' ? '\\' : '/';
        const home = info.home.replace(/[\\/]+$/, '');
        const candidate = `${home}${sep}bin${sep}${name}${platform === 'win32' ? '.exe' : ''}`;
        if (existsSync(candidate)) return candidate;
    }
    return name;
}

function formatProblemDetails({ problem, runtime, executable, stderr, launcherVersion, platform, arch, homeDir }) {
    const lines = [
        `Problem: ${problem.title} (${problem.kind})`,
        `Details: ${problem.message}`,
        `Fix: ${problem.recovery}`,
        `Runtime: ${describeRuntime(runtime)}`
    ];
    if (runtime && runtime.home) lines.push(`Java home: ${runtime.home}`);
    if (executable) lines.push(`Executable: ${executable}`);
    lines.push(`Launcher: ${launcherVersion || 'unknown'} on ${platform} ${arch}`);
    const tail = boundedTail(stderr || problem.stderr || '');
    if (tail) lines.push('', 'Java output:', tail);
    return redactText(lines.join('\n'), { homeDir });
}

module.exports = {
    MIN_JAVA_MAJOR,
    RECOMMENDED_JAVA_MAJOR,
    ZGC_MIN_JAVA_MAJOR,
    MAX_32_BIT_HEAP_MB,
    PROBE_ARGS,
    parseJavaMajor,
    parseJavaSettings,
    heapMbFromArgs,
    describeRuntime,
    evaluateRuntime,
    supportedVmArgs,
    redactText,
    boundedTail,
    classifyProbeFailure,
    classifyLaunchFailure,
    javaDownloadUrl,
    launcherExecutable,
    formatProblemDetails
};
