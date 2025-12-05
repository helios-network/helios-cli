const ora = require('ora');
const Docker = require('dockerode');

function snapshotsStart(options) {
    return new Promise((resolve, reject) => {
        const docker = new Docker();
        const containerName = 'helios-backups-provider';
        const imageName = 'helios-backups-provider:latest';
        
        const port = options.argv.port || options.argv.p || 5050;
        const host = options.argv.host || options.argv.H || 'snapshots.helioschainlabs.org';
        const rate = options.argv.rate || options.argv.r || 100;

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
                        spinner.fail(`Docker image ${imageName} not found. Please build it first.`);
                        reject(new Error(`Image ${imageName} not found`));
                        return;
                    }
                    
                    createAndStartContainer();
                });
                
                function createAndStartContainer() {
                    spinner.text = 'Starting container...';
                    
                    const binds = [];
                    
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
