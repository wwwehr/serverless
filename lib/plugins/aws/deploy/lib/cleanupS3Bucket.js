'use strict';

const _ = require('lodash');
const findAndGroupDeployments = require('../../utils/findAndGroupDeployments');
const getS3ObjectsFromStacks = require('../../utils/getS3ObjectsFromStacks');
const { legacy, log } = require('@serverless/utils/log');

module.exports = {
  async getObjectsToRemove() {
    const stacksToKeepCount = _.get(
      this.serverless,
      'service.provider.deploymentBucketObject.maxPreviousDeploymentArtifacts',
      5
    );

    const stacks = await this.findDeployments();
    const stacksToRemove = stacks.slice(0, -stacksToKeepCount || Infinity);
    const objectsToRemove = _.flatMap(
      stacksToRemove,
      ({ prefix, templateDirectory, artifactNames }) =>
        [
          `${prefix}/${templateDirectory}/${this.provider.naming.getCompiledTemplateS3Suffix()}`,
          ...artifactNames,
        ].map((key) => ({ Key: key }))
    );

    if (objectsToRemove.length) return objectsToRemove;
    return [];
  },

  async removeObjects(objectsToRemove) {
    if (!objectsToRemove || !objectsToRemove.length) return;
    legacy.log('Removing old service artifacts from S3...');
    log.info('Removing old service artifacts from S3');
    await this.provider.request('S3', 'deleteObjects', {
      Bucket: this.bucketName,
      Delete: { Objects: objectsToRemove },
    });
  },

  async cleanupS3Bucket() {
    const objectsToRemove = await this.getObjectsToRemove();
    await this.removeObjects(objectsToRemove);
  },
};
