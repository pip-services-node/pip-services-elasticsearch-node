/** @module build */
import { Factory } from 'pip-services-components-node';
import { Descriptor } from 'pip-services-commons-node';

import { ElasticSearchLogger } from '../log/ElasticSearchLogger';

/**
 * Contains a static read-only descriptor for the [[ElasticSearchLogger]] class and a default
 * "elasticsearch" descriptor.
 * 
 * @see [[https://rawgit.com/pip-services-node/pip-services-components-node/master/doc/api/classes/build.factory.html Factory]]
 */
export class DefaultElasticSearchFactory extends Factory {
	public static readonly Descriptor = new Descriptor("pip-services", "factory", "elasticsearch", "default", "1.0");
	public static readonly ElasticSearchLoggerDescriptor = new Descriptor("pip-services", "logger", "elasticsearch", "*", "1.0");

	/**
	 * Create a new DefaultElasticSearchFactory object, containing a [[ElasticSearchLogger]] object factory.
	 * 
	 * @see [[HttpEndpoint]]
     * @see [[HeartbeatRestService]]
     * @see [[StatusRestService]] 
	 */
	public constructor() {
        super();
		this.registerAsType(DefaultElasticSearchFactory.ElasticSearchLoggerDescriptor, ElasticSearchLogger);
	}
}