/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import Hapi from 'hapi';
import { isFunction } from 'lodash/fp';

import { DETECTION_ENGINE_RULES_URL } from '../../../../../common/constants';
import { deleteRules } from '../../rules/delete_rules';
import { ServerFacade } from '../../../../types';
import { queryRulesSchema } from '../schemas/query_rules_schema';
import { getIdError, transform } from './utils';
import { transformError } from '../utils';
import { QueryRequest, IRuleSavedAttributesSavedObjectAttributes } from '../../rules/types';
import { ruleStatusSavedObjectType } from '../../rules/saved_object_mappings';

export const createDeleteRulesRoute: Hapi.ServerRoute = {
  method: 'DELETE',
  path: DETECTION_ENGINE_RULES_URL,
  options: {
    tags: ['access:siem'],
    validate: {
      options: {
        abortEarly: false,
      },
      query: queryRulesSchema,
    },
  },
  async handler(request: QueryRequest, headers) {
    const { id, rule_id: ruleId } = request.query;
    const alertsClient = isFunction(request.getAlertsClient) ? request.getAlertsClient() : null;
    const actionsClient = isFunction(request.getActionsClient) ? request.getActionsClient() : null;
    const savedObjectsClient = isFunction(request.getSavedObjectsClient)
      ? request.getSavedObjectsClient()
      : null;
    if (!alertsClient || !actionsClient || !savedObjectsClient) {
      return headers.response().code(404);
    }

    try {
      const rule = await deleteRules({
        actionsClient,
        alertsClient,
        id,
        ruleId,
      });
      if (rule != null) {
        const ruleStatuses = await savedObjectsClient.find<
          IRuleSavedAttributesSavedObjectAttributes
        >({
          type: ruleStatusSavedObjectType,
          perPage: 6,
          search: rule.id,
          searchFields: ['alertId'],
        });
        ruleStatuses.saved_objects.forEach(async obj =>
          savedObjectsClient.delete(ruleStatusSavedObjectType, obj.id)
        );
        const transformed = transform(rule, ruleStatuses.saved_objects[0]);
        if (transformed == null) {
          return headers
            .response({
              message: 'Internal error transforming rules',
              status_code: 500,
            })
            .code(500);
        } else {
          return transformed;
        }
      } else {
        const error = getIdError({ id, ruleId });
        return headers
          .response({
            message: error.message,
            status_code: error.statusCode,
          })
          .code(error.statusCode);
      }
    } catch (err) {
      const error = transformError(err);
      return headers
        .response({
          message: error.message,
          status_code: error.statusCode,
        })
        .code(error.statusCode);
    }
  },
};

export const deleteRulesRoute = (server: ServerFacade): void => {
  server.route(createDeleteRulesRoute);
};
