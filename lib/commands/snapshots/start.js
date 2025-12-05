const ora = require('ora');
const path = require('path');
const fs = require('fs');
const Docker = require('dockerode');
const getPathHelios = require('../../utils/getPathHelios');

const DOCKER_IMAGE = 'heliosfoundation/docker-helios-backups-provider:latest';

function snapshotsStart(options) {
    return new Promise((resolve, reject) => {
        const docker = new Docker();
        const containerName = 'helios-backups-provider';
        const imageName = DOCKER_IMAGE;
        
        const port = options.argv.port || options.argv.p || 5050;
        const host = options.argv.host || options.argv.H || 'snapshots.helioschainlabs.org';
        const rate = options.argv.rate || options.argv.r || 100;
        
        let volumePath = options.argv['backups-dir'] || options.argv.d;
        
        if (!volumePath) {
            const pathHelios = getPathHelios();
            if (!pathHelios) {
                reject("No Helios path found. Please specify --backups-dir or start a node first.");
                return;
            }
            volumePath = path.join(pathHelios, 'data', 'node1', '.heliades');
        }
        
        volumePath = path.resolve(volumePath);
        
        if (!fs.existsSync(volumePath)) {
            reject(`Backups directory not found: ${volumePath}`);
            return;
        }

        const spinner = ora('Starting snapshots provider in Docker...').start();

        docker.getContainer(containerName).inspect((err, containerInfo) => {
            if (!err && containerInfo) {
                if (containerInfo.State.Running) {
                    spinner.fail('Snapshots provider container is already running');
                    resolve(undefined);
                    return;
                } else {
                    spinner.text = 'Removing old container...';
                    docker.getContainer(containerName).remove((removeErr) => {
                        if (removeErr) {
                            spinner.fail(`Failed to remove old container: ${removeErr.message}`);
                            reject(removeErr);
                            return;
                        }
                        proceedWithImageCheck();
                    });
                    return;
                }
            }
            
            proceedWithImageCheck();
            
            function proceedWithImageCheck() {
                docker.getImage(imageName).inspect((err, imageInfo) => {
                    if (err || !imageInfo) {
                        spinner.fail(`Docker image ${imageName} not found. Please run 'helios snapshots install' first.`);
                        reject(new Error(`Image ${imageName} not found. Run 'helios snapshots install' to download it.`));
                        return;
                    }
                    
                    createAndStartContainer();
                });
                
                function createAndStartContainer() {
                    spinner.text = 'Starting container...';
                    
                    const binds = [];
                    
                    binds.push(`${volumePath}:/root/.heliades:ro`);
                    
                    docker.createContainer({
                        Image: imageName,
                        name: containerName,
                        ExposedPorts: {
                            [`${port}/tcp`]: {}
                        },
                        HostConfig: {
                            PortBindings: {
                                [`${port}/tcp`]: [{ HostPort: `${port}` }]
                            },
                            Binds: binds
                        },
                        Env: [
                            `PORT=${port}`,
                            `HOST=${host}`,
                            `MAX_DOWNLOAD_RATE=${rate * 1024 * 1024}`
                        ],
                        Cmd: ['node', 'dist/index.js', 'serve', '-p', port.toString(), '-H', host, '-r', rate.toString()]
                    }, (err, container) => {
                        if (err) {
                            spinner.fail(`Failed to create container: ${err.message}`);
                            reject(err);
                            return;
                        }

                        container.start((err) => {
                            if (err) {
                                spinner.fail(`Failed to start container: ${err.message}`);
                                reject(err);
                            } else {
                                spinner.succeed(`Snapshots provider started successfully on port ${port}`);
                                resolve(undefined);
                            }
                        });
                    });
                }
            }
        });
    });
}

module.exports = snapshotsStart;
