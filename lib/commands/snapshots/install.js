const ora = require('ora');
const Docker = require('dockerode');

const DOCKER_IMAGE = 'heliosfoundation/docker-helios-backups-provider:latest';

function snapshotsInstall(options) {
    return new Promise((resolve, reject) => {
        const docker = new Docker();
        const spinner = ora('Downloading snapshots provider image from Docker Hub...').start();

        docker.pull(DOCKER_IMAGE, (err, stream) => {
            if (err) {
                spinner.fail(`Failed to pull image: ${err.message}`);
                reject(err);
                return;
            }

            docker.modem.followProgress(stream, (err, output) => {
                if (err) {
                    spinner.fail(`Failed to download image: ${err.message}`);
                    reject(err);
                    return;
                }

                spinner.succeed(`Successfully installed snapshots provider image`);
                resolve(undefined);
            }, (event) => {
                if (event.status) {
                    spinner.text = `Downloading: ${event.status}`;
                }
            });
        });
    });
}

module.exports = snapshotsInstall;
