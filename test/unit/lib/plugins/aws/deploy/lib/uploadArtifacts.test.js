'use strict';

/* eslint-disable no-unused-expressions */

const sinon = require('sinon');
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const chai = require('chai');
const proxyquire = require('proxyquire');
const normalizeFiles = require('../../../../../../../lib/plugins/aws/lib/normalizeFiles');
const AwsProvider = require('../../../../../../../lib/plugins/aws/provider');
const AwsDeploy = require('../../../../../../../lib/plugins/aws/deploy/index');
const Serverless = require('../../../../../../../lib/Serverless');
const { getTmpDirPath, createTmpDir } = require('../../../../../../utils/fs');

chai.use(require('chai-as-promised'));
chai.use(require('sinon-chai'));

const expect = chai.expect;

describe('uploadArtifacts', () => {
  let serverless;
  let awsDeploy;
  let cryptoStub;
  let tmpDirPath;
  let artifactFilePath;

  before(() => {
    tmpDirPath = getTmpDirPath();
    artifactFilePath = path.join(tmpDirPath, 'artifact.zip');
    serverless = new Serverless();
    serverless.utils.writeFileSync(artifactFilePath, 'artifact.zip file content');
  });

  beforeEach(() => {
    serverless = new Serverless();
    serverless.serviceDir = 'foo';
    serverless.setProvider('aws', new AwsProvider(serverless, {}));
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    };

    awsDeploy = new AwsDeploy(serverless, options);
    awsDeploy.bucketName = 'deployment-bucket';
    awsDeploy.serverless.service.package.deploymentDirectoryPrefix = 'somedir';
    awsDeploy.serverless.service.package.timestamp = 'sometimestamp';
    awsDeploy.serverless.service.package.artifactsMap = {
      [artifactFilePath]: 'somedir/code-artifacts/cafebabe.zip',
    };
    awsDeploy.serverless.service.functions = {
      first: {
        handler: 'foo',
      },
    };
    awsDeploy.serverless.service.provider.compiledCloudFormationTemplate = {
      foo: 'bar',
    };
    awsDeploy.serverless.cli = new serverless.classes.CLI();
    cryptoStub = {
      createHash() {
        return this;
      },
      update() {
        return this;
      },
      digest: sinon.stub(),
    };
    const uploadArtifacts = proxyquire(
      '../../../../../../../lib/plugins/aws/deploy/lib/uploadArtifacts.js',
      {
        crypto: cryptoStub,
      }
    );
    Object.assign(awsDeploy, uploadArtifacts);
  });

  describe('#uploadCloudFormationFile()', () => {
    let normalizeCloudFormationTemplateStub;
    let awsRequestStub;

    beforeEach(() => {
      normalizeCloudFormationTemplateStub = sinon
        .stub(normalizeFiles, 'normalizeCloudFormationTemplate')
        .returns();
      awsRequestStub = sinon.stub(awsDeploy.provider, 'request').resolves();
    });

    afterEach(() => {
      normalizeCloudFormationTemplateStub.restore();
      awsRequestStub.restore();
    });

    it('should upload the CloudFormation file to the S3 bucket', () => {
      cryptoStub.createHash().update().digest.onCall(0).returns('local-hash-cf-template');

      return awsDeploy.uploadCloudFormationFile().then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
        expect(awsRequestStub).to.have.been.calledOnce;
        expect(awsRequestStub).to.have.been.calledWithExactly('S3', 'upload', {
          Bucket: awsDeploy.bucketName,
          Key: 'somedir/sometimestamp/compiled-cloudformation-template.json',
          Body: JSON.stringify({ foo: 'bar' }),
          ContentType: 'application/json',
          Metadata: {
            filesha256: 'local-hash-cf-template',
          },
        });
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly({
          foo: 'bar',
        });
      });
    });

    it('should upload the CloudFormation file to a bucket with SSE bucket policy', () => {
      cryptoStub.createHash().update().digest.onCall(0).returns('local-hash-cf-template');
      awsDeploy.serverless.service.provider.deploymentBucketObject = {
        serverSideEncryption: 'AES256',
      };

      return awsDeploy.uploadCloudFormationFile().then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
        expect(awsRequestStub).to.have.been.calledOnce;
        expect(awsRequestStub).to.have.been.calledWithExactly('S3', 'upload', {
          Bucket: awsDeploy.bucketName,
          Key: 'somedir/sometimestamp/compiled-cloudformation-template.json',
          Body: JSON.stringify({ foo: 'bar' }),
          ContentType: 'application/json',
          ServerSideEncryption: 'AES256',
          Metadata: {
            filesha256: 'local-hash-cf-template',
          },
        });
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly({
          foo: 'bar',
        });
      });
    });
  });

  describe('#uploadZipFile()', () => {
    let readFileSyncStub;
    let awsRequestStub;

    beforeEach(() => {
      readFileSyncStub = sinon.stub(fs, 'readFileSync').returns();
      awsRequestStub = sinon.stub(awsDeploy.provider, 'request');
      awsRequestStub
        .withArgs('S3', 'headObject')
        .rejects({ code: 'AWS_S3_HEAD_OBJECT_NOT_FOUND' })
        .withArgs('S3', 'upload')
        .resolves();
    });

    afterEach(() => {
      readFileSyncStub.restore();
      awsRequestStub.restore();
    });

    it('should throw for null artifact paths', async () => {
      await expect(awsDeploy.uploadZipFile(null)).to.be.rejectedWith(Error);
    });

    describe('when file does not exist on the S3', () => {
      beforeEach(() => {
        awsRequestStub
          .withArgs('S3', 'headObject')
          .rejects({ code: 'AWS_S3_HEAD_OBJECT_NOT_FOUND' })
          .withArgs('S3', 'upload')
          .resolves();
      });

      it('should upload the .zip file to the S3 bucket', () => {
        cryptoStub.createHash().update().digest.onCall(0).returns('local-hash-zip-file');

        return awsDeploy.uploadZipFile(artifactFilePath).then(() => {
          expect(awsRequestStub).to.have.been.calledTwice;
          expect(awsRequestStub).to.have.been.calledWithExactly('S3', 'headObject', {
            Bucket: awsDeploy.bucketName,
            Key: sinon.match(/somedir\/code-artifacts\/[0-9a-f]+.zip/),
          });
          expect(awsRequestStub).to.have.been.calledWithExactly('S3', 'upload', {
            Bucket: awsDeploy.bucketName,
            Key: sinon.match(/somedir\/code-artifacts\/[0-9a-f]+.zip/),
            Body: sinon.match.object.and(sinon.match.has('path', artifactFilePath)),
            ContentType: 'application/zip',
            Metadata: {
              filesha256: 'local-hash-zip-file',
            },
          });
          expect(readFileSyncStub).to.have.been.calledWithExactly(artifactFilePath);
        });
      });

      it('should upload the .zip file to a bucket with SSE bucket policy', () => {
        cryptoStub.createHash().update().digest.onCall(0).returns('local-hash-zip-file');

        awsDeploy.serverless.service.provider.deploymentBucketObject = {
          serverSideEncryption: 'AES256',
        };

        return awsDeploy.uploadZipFile(artifactFilePath).then(() => {
          expect(awsRequestStub).to.have.been.calledTwice;
          expect(readFileSyncStub).to.have.been.calledOnce;
          expect(awsRequestStub).to.have.been.calledWithExactly('S3', 'upload', {
            Bucket: awsDeploy.bucketName,
            Key: sinon.match(/somedir\/code-artifacts\/[0-9a-f]+.zip/),
            Body: sinon.match.object.and(sinon.match.has('path', artifactFilePath)),
            ContentType: 'application/zip',
            ServerSideEncryption: 'AES256',
            Metadata: {
              filesha256: 'local-hash-zip-file',
            },
          });
          expect(readFileSyncStub).to.have.been.calledWithExactly(artifactFilePath);
        });
      });

      it('should log artifact size', () => {
        sinon.spy(awsDeploy.serverless.cli, 'log');
        cryptoStub.createHash().update().digest.onCall(0).returns('local-hash-zip-file');

        return awsDeploy.uploadZipFile(artifactFilePath).then(() => {
          const expected = 'Uploading service artifact ZIP file to S3 (25 B)...';
          expect(awsDeploy.serverless.cli.log.calledWithExactly(expected)).to.be.equal(true);
        });
      });
    });

    describe('when file already exists on the S3', () => {
      beforeEach(() => {
        awsRequestStub.withArgs('S3', 'headObject').resolves({});
      });

      it('should just check the file existence on S3', () => {
        return awsDeploy.uploadZipFile(artifactFilePath).then(() => {
          expect(awsRequestStub).to.have.been.calledOnce;
          expect(awsRequestStub).to.have.been.calledWithExactly('S3', 'headObject', {
            Bucket: awsDeploy.bucketName,
            Key: sinon.match(/somedir\/code-artifacts\/[0-9a-f]+.zip/),
          });
        });
      });

      it('should log information about upload already done', () => {
        sinon.spy(awsDeploy.serverless.cli, 'log');
        return awsDeploy.uploadZipFile(artifactFilePath).then(() => {
          const expected = sinon.match(
            /Artifact artifact already uploaded to somedir\/code-artifacts\/[0-9a-f]+.zip/
          );
          expect(awsDeploy.serverless.cli.log.calledWithExactly(expected)).to.be.equal(true);
        });
      });
    });
  });

  describe('#uploadFunctionsAndLayers()', () => {
    let uploadZipFileStub;

    beforeEach(() => {
      sinon.stub(fs.promises, 'stat').resolves({ size: 1024 });
      uploadZipFileStub = sinon.stub(awsDeploy, 'uploadZipFile').resolves();
    });

    afterEach(() => {
      fs.promises.stat.restore();
      uploadZipFileStub.restore();
    });

    it('should upload the service artifact file to the S3 bucket', () => {
      awsDeploy.serverless.serviceDir = 'some/path';
      awsDeploy.serverless.service.service = 'new-service';

      return awsDeploy.uploadFunctionsAndLayers().then(() => {
        expect(uploadZipFileStub.calledOnce).to.be.equal(true);
        const expectedPath = path.join('foo', '.serverless', 'new-service.zip');
        expect(uploadZipFileStub.args[0][0]).to.be.equal(expectedPath);
      });
    });

    it('should upload a single .zip file to the S3 bucket when not packaging individually', () => {
      awsDeploy.serverless.service.functions = {
        first: {
          package: {
            artifact: 'artifact.zip',
          },
        },
        second: {
          package: {
            artifact: 'artifact.zip',
          },
        },
      };

      return awsDeploy.uploadFunctionsAndLayers().then(() => {
        expect(uploadZipFileStub.calledOnce).to.be.equal(true);
        expect(uploadZipFileStub.args[0][0]).to.be.equal('artifact.zip');
      });
    });

    it('should upload the function .zip files to the S3 bucket', () => {
      awsDeploy.serverless.service.package.individually = true;
      awsDeploy.serverless.service.functions = {
        first: {
          package: {
            artifact: 'first-artifact.zip',
          },
        },
        second: {
          package: {
            artifact: 'second-artifact.zip',
          },
        },
      };

      return awsDeploy.uploadFunctionsAndLayers().then(() => {
        expect(uploadZipFileStub.calledTwice).to.be.equal(true);
        expect(uploadZipFileStub.args[0][0]).to.be.equal(
          awsDeploy.serverless.service.functions.first.package.artifact
        );
        expect(uploadZipFileStub.args[1][0]).to.be.equal(
          awsDeploy.serverless.service.functions.second.package.artifact
        );
      });
    });

    it('should upload single function artifact and service artifact', () => {
      awsDeploy.serverless.service.package.artifact = 'second-artifact.zip';
      awsDeploy.serverless.service.functions = {
        first: {
          handler: 'bar',
          package: {
            artifact: 'first-artifact.zip',
            individually: true,
          },
        },
        second: {
          handler: 'foo',
        },
      };

      return awsDeploy.uploadFunctionsAndLayers().then(() => {
        expect(uploadZipFileStub.calledTwice).to.be.equal(true);
        expect(uploadZipFileStub.args[0][0]).to.be.equal(
          awsDeploy.serverless.service.functions.first.package.artifact
        );
        expect(uploadZipFileStub.args[1][0]).to.be.equal(
          awsDeploy.serverless.service.package.artifact
        );
      });
    });
  });

  describe('#uploadCustomResources()', () => {
    let awsRequestStub;
    let serviceDirPath;
    let customResourcesFilePath;

    beforeEach(() => {
      awsRequestStub = sinon.stub(awsDeploy.provider, 'request');
      awsRequestStub
        .withArgs('S3', 'headObject')
        .rejects({ code: 'AWS_S3_HEAD_OBJECT_NOT_FOUND' })
        .withArgs('S3', 'upload')
        .resolves();

      serviceDirPath = createTmpDir();
      customResourcesFilePath = path.join(serviceDirPath, '.serverless', 'custom-resources.zip');
      serverless.serviceDir = serviceDirPath;
      serverless.service.package.artifactsMap = {
        [customResourcesFilePath]: 'somedir/code-artifacts/deadcafe.zip',
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should not attempt to upload a custom resources if the artifact does not exist', () => {
      return expect(awsDeploy.uploadCustomResources()).to.eventually.be.fulfilled.then(() => {
        expect(awsRequestStub).not.to.be.called;
      });
    });

    it('should upload the custom resources .zip file to the S3 bucket', () => {
      fse.ensureFileSync(customResourcesFilePath);
      cryptoStub.createHash().update().digest.onCall(0).returns('local-hash-zip-file');

      return expect(awsDeploy.uploadCustomResources()).to.eventually.be.fulfilled.then(() => {
        expect(awsRequestStub).to.have.been.calledTwice;
        expect(awsRequestStub).to.have.been.calledWithExactly('S3', 'upload', {
          Bucket: awsDeploy.bucketName,
          Key: sinon.match(/somedir\/code-artifacts\/[0-9a-f]+.zip/),
          Body: sinon.match.object.and(sinon.match.has('path', customResourcesFilePath)),
          ContentType: 'application/zip',
          Metadata: {
            filesha256: 'local-hash-zip-file',
          },
        });
      });
    });
  });
});
