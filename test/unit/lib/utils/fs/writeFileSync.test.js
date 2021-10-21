'use strict';

const fsp = require('fs').promises;
const Serverless = require('../../../../../lib/Serverless');
const writeFileSync = require('../../../../../lib/utils/fs/writeFileSync');
const readFileSync = require('../../../../../lib/utils/fs/readFileSync');
const { expect } = require('chai');
const { getTmpFilePath } = require('../../../../utils/fs');

describe('#writeFileSync()', () => {
  let serverless;

  beforeEach(() => {
    serverless = new Serverless();
  });

  it('should write a .json file synchronously', () => {
    const tmpFilePath = getTmpFilePath('anything.json');

    writeFileSync(tmpFilePath, { foo: 'bar' });
    const obj = readFileSync(tmpFilePath);

    expect(obj.foo).to.equal('bar');
  });

  it('should write a .yml file synchronously', () => {
    const tmpFilePath = getTmpFilePath('anything.yml');

    writeFileSync(tmpFilePath, { foo: 'bar' });

    return serverless.yamlParser.parse(tmpFilePath).then((obj) => {
      expect(obj.foo).to.equal('bar');
    });
  });

  it('should write a .yaml file synchronously', () => {
    const tmpFilePath = getTmpFilePath('anything.yaml');

    writeFileSync(tmpFilePath, { foo: 'bar' });

    return serverless.yamlParser.parse(tmpFilePath).then((obj) => {
      expect(obj.foo).to.equal('bar');
    });
  });

  it('should throw error if invalid path is provided', () => {
    expect(() => {
      writeFileSync(null);
    }).to.throw(Error);
  });

  it('should be able to write an object with circular references', () => {
    const tmpFilePath = getTmpFilePath('anything.json');
    const bar = {};
    bar.foo = bar;
    const expected = '{\n  "foo": {\n    "$ref": "$"\n  }\n}';

    writeFileSync(tmpFilePath, bar, true);

    return fsp.readFile(tmpFilePath, 'utf8').then((contents) => {
      expect(contents).to.equal(expected);
    });
  });
});
