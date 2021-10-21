'use strict';
const validate = require('./lib/validate');
const setBucketName = require('./lib/setBucketName');
const updateStack = require('./lib/updateStack');
const monitorStack = require('./lib/monitorStack');
const findDeployments = require('./lib/findDeployments');
const ServerlessError = require('../../serverless-error');
const { style, log, progress, legacy } = require('@serverless/utils/log');

const mainProgress = progress.get('main');

class AwsRollback {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');

    Object.assign(this, validate, setBucketName, updateStack, monitorStack, findDeployments);

    this.hooks = {
      'before:rollback:initialize': async () => this.validate(),

      'rollback:rollback': async () => {
        if (!this.options.timestamp) {
          legacy.log(
            [
              'Use a timestamp from the deploy list below to rollback to a specific version.',
              'Run `sls rollback -t YourTimeStampHere`',
            ].join('\n')
          );
          log.notice(
            'Select a timestamp from the deploy list below and run "sls rollback -t <timestamp>" to rollback your service to a specific version.'
          );
          log.notice();
          await this.serverless.pluginManager.spawn('deploy:list');
          return;
        }

        log.notice();
        log.notice(
          `Rolling back ${this.serverless.service.service} to timestamp "${this.options.timestamp}"`
        );
        log.info(); // Ensure gap between verbose logging

        await this.setBucketName();
        await this.setStackToUpdate();
        mainProgress.notice('Validating', { isMainEvent: true });
        const result = await this.updateStack();

        log.notice();
        if (result) {
          log.notice.success(
            `Service rolled back to timestamp "${this.options.timestamp}" ${style.aside(
              `(${Math.floor(
                (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
              )}s)`
            )}`
          );
        } else {
          log.notice.skip(
            `No updates to be performed. Rollback skipped. ${style.aside(
              `(${Math.floor(
                (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
              )}s)`
            )}`
          );
        }
      },
    };
  }

  async setStackToUpdate() {
    const deployments = await this.findDeployments();
    if (deployments.length === 0) {
      const msg = "Couldn't find any existing deployments.";
      const hint = 'Please verify that stage and region are correct.';
      throw new ServerlessError(`${msg} ${hint}`, 'ROLLBACK_DEPLOYMENTS_NOT_FOUND');
    }

    const existing = deployments.find(
      ({ timestamp }) => String(this.options.timestamp) === timestamp
    );
    if (!existing) {
      const msg = `Couldn't find a deployment for the timestamp: ${this.options.timestamp}.`;
      const hint = 'Please verify that the timestamp, stage and region are correct.';
      throw new ServerlessError(`${msg} ${hint}`, 'ROLLBACK_DEPLOYMENT_NOT_FOUND');
    }
    const { service } = this.serverless;
    service.package.deploymentDirectoryPrefix = existing.prefix;
    service.package.timestamp = existing.templateDirectory;
  }
}

module.exports = AwsRollback;
