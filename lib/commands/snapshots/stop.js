const ora = require('ora');
const Docker = require('dockerode');

function snapshotsStop(options) {
    return new Promise((resolve, reject) => {
        const docker = new Docker();
        const containerName = 'helios-backups-provider';
        const spinner = ora('Stopping snapshots provider...').start();

        docker.getContainer(containerName).inspect((err, containerInfo) => {
            if (err) {
                if (err.statusCode === 404) {
                    spinner.fail('Snapshots provider container not found');
                    resolve(undefined);
                } else {
                    spinner.fail(`Failed to inspect container: ${err.message}`);
                    reject(err);
                }
                return;
            }

            if (!containerInfo.State.Running) {
                spinner.text = 'Removing stopped container...';
                docker.getContainer(containerName).remove((err) => {
                    if (err) {
                        spinner.fail(`Failed to remove container: ${err.message}`);
                        reject(err);
                    } else {
                        spinner.succeed('Snapshots provider container removed successfully');
                        resolve(undefined);
                    }
                });
                return;
            }

            docker.getContainer(containerName).stop((err) => {
                if (err) {
                    spinner.fail(`Failed to stop container: ${err.message}`);
                    reject(err);
                } else {
                    spinner.text = 'Removing container...';
                    docker.getContainer(containerName).remove((removeErr) => {
                        if (removeErr) {
                            spinner.fail(`Failed to remove container: ${removeErr.message}`);
                            reject(removeErr);
                        } else {
                            spinner.succeed('Snapshots provider stopped and removed successfully');
                            resolve(undefined);
                        }
                    });
                }
            });
        });
    });
}

module.exports = snapshotsStop;
