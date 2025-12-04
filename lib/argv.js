const yargsParser = require('yargs-parser');

module.exports = parse;

const parserConfig = {
    alias: {
        version: 'v',
        help: 'h',
        port: 'p',
        daemon: 'd',
        rate: 'r',
        host: 'H'
    },
    array: [],
    nargs: {
        start: 1,
        stop: 1,
        install: 1,
        reset: 1,
        port: 1,
        rate: 1,
        host: 1
    },
    boolean: ['version', 'help', 'daemon'],
};

function version() {
    const {
        version
    } = require('../package.json');
    return `helios version: ${ version }`;
}

function usage() {
    return `
Usage:
  helios [command] [options]

Commands:
  start                Start NodeManager
  stop                 Stop NodeManager
  install              Install NodeManager
  update               Update NodeManager
  reset                Reset NodeManager
  generate-wallet      Generate Wallet
  firewall             Firewall (suggestions)
  snapshot-server      Snapshot server (use: serve, stop, status)

Global Options:
  -v, --version      Show version number
  -h, --help         Show help

For command-specific help, use:
  helios [command] -h
  helios [command] --help

Examples:
  helios start
  helios snapshot-server serve -d
  helios snapshot-server -h
`;
}

function parse(args = process.argv.slice(2)) {
    let argv = yargsParser(args, parserConfig);

    if (argv.version) {
        argv._[0] = 'version';
    }
    
    // If help is requested without a command, show general help
    if (argv.help && argv._.length === 0) {
        console.log(usage());
        return 0;
    }
    
    // If help is requested with a command, let the command handle it
    if (argv.help && argv._.length > 0) {
        argv.command = argv._[0];
        return argv; // Let the command handle its own help
    }
    
    if (argv.p && !Number.isInteger(argv.p)) {
        console.error('--port need number value.');
        return 0;
    }
    if (argv._.length == 0) {
        console.log(usage());
        console.error('Please specify a single command.');
        return 1;
    }
    argv.command = argv._[0];
    return argv;
}