const yargsParser = require('yargs-parser');

module.exports = parse;

const parserConfig = {
    alias: {
        version: 'v',
        help: 'h',
        port: 'p'
    },
    array: [],
    nargs: {
        start: 1,
        stop: 1,
        install: 1,
        reset: 1,
        port: 1
    },
    boolean: ['version', 'help'],
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
  node_modules/.bin/helios [command] [options]

Commands:
  start                Start NodeManager
  stop                 Stop NodeManager
  install              Install NodeManager
  update               Update NodeManager
  reset                Reset NodeManager
  generate-wallet      Generate Wallet
  firewall             Firewall (suggestions)
  snapshots            Manage snapshots Provider in Docker (use: snapshots start/stop)

Options:
  -p, --port         change debug port default --port=8080
  -v, --version      Show version number
  -h, --help         Show help
`;
}

function parse(args = process.argv.slice(2)) {
    let argv = yargsParser(args, parserConfig);

    if (argv.version) {
        argv._[0] = 'version';
    }
    if (argv.help) {
        console.log(usage());
        return 0;
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