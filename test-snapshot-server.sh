#!/bin/bash

echo "Running Snapshot Server Tests..."
echo "================================"

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

if [ -f "node_modules/.bin/mocha" ]; then
    echo "Running tests with mocha..."
    ./node_modules/.bin/mocha test/snapshot-server.test.js --timeout 10000
else
    echo "Mocha not found. Trying to run with node..."
    node -e "require('mocha/bin/mocha')" test/snapshot-server.test.js --timeout 10000
fi

