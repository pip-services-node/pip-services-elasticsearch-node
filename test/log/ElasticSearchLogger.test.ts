import { ConfigParams } from 'pip-services-commons-node';

import { ElasticSearchLogger } from '../../src/log/ElasticSearchLogger';
import { LoggerFixture } from '../fixtures/LoggerFixture';

suite('ElasticSearchLogger', ()=> {
    let _logger: ElasticSearchLogger;
    let _fixture: LoggerFixture;

    setup((done) => {
        let host = process.env['ELASTICSEARCH_SERVICE_HOST'] || 'localhost';
        let port = process.env['ELASTICSEARCH_SERVICE_PORT'] || 9200;

        _logger = new ElasticSearchLogger();
        _fixture = new LoggerFixture(_logger);

        let config = ConfigParams.fromTuples(
            'source', 'test',
            'index', 'log',
            'daily', true,
            'connection.host', host,
            'connection.port', port
        );
        _logger.configure(config);

        _logger.open(null, (err) => {
             done(err);
        });
    });

    teardown((done) => {
        _logger.close(null, done);
    });

    test('Log Level', () => {
        _fixture.testLogLevel();
    });

    test('Simple Logging', (done) => {
        _fixture.testSimpleLogging(done);
    });

    test('Error Logging', (done) => {
        _fixture.testErrorLogging(done);
    });

});