/**
 * @license Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

'use strict';

const Audit = require('./audit');
const URL = require('../lib/url-shim');
const Util = require('../report/v2/renderer/util');
const UnusedBytes = require('./byte-efficiency/byte-efficiency-audit');

class UsesRelPreloadAudit extends Audit {
  /**
   * @return {!AuditMeta}
   */
  static get meta() {
    return {
      category: 'Performance',
      name: 'uses-rel-preload',
      description: 'Critical resources that are discovered late can be preloaded to fetch them' +
        'earlier.',
      failureDescription: 'Scripts were discovered late but fetching them earlier may have ' +
        'improved how quickly the page was interactive',
      helpText: 'Consider using <link rel=preload> to prioritize fetching late-discovered ' +
        'resources sooner [Learn more]().',
      requiredArtifacts: ['devtoolsLogs'],
    };
  }

  static _flattenRequests(chains, maxLevel, minLevel = 0) {
    const requests = [];
    const flatten = (chains, level) => {
      for (const chain in chains) {
        if (chains[chain]) {
          const currentChain = chains[chain];
          if (level >= minLevel) {
            const request = Object.assign(
              {},
              currentChain.request,
              {
                id: chain,
              }
            );
            requests.push(request);
          }

          if (level < maxLevel) {
            flatten(currentChain.children, level + 1);
          }
        }
      }
    };

    flatten(chains, 0);

    return requests;
  }

  /**
   * @param {!Artifacts} artifacts
   * @return {!AuditResult}
   */
  static audit(artifacts) {
    const devtoolsLogs = artifacts.devtoolsLogs[UsesRelPreloadAudit.DEFAULT_PASS];

    return Promise.all([
      artifacts.requestNetworkRecords(devtoolsLogs),
      artifacts.requestCriticalRequestChains(devtoolsLogs),
    ]).then(([networkRecords, critChains]) => {
      const results = [];
      let totalWastedMs = 0;
      // get all critical requests 2 levels deep
      const criticalRequests = UsesRelPreloadAudit._flattenRequests(critChains, 2, 2);
      criticalRequests.forEach(request => {
        const networkRecord = networkRecords.find(
          networkRecord => networkRecord.requestId === request.id
        );

        if (
          !networkRecord._isLinkPreload && networkRecord._resourceType &&
          networkRecord._resourceType._name === 'script'
        ) {
          const wastedMs = (request.endTime - request.startTime) * 1000;
          totalWastedMs += wastedMs;
          results.push({
            url: request.url,
            downloadTime: Util.formatMilliseconds(wastedMs),
          });
        }
      });
      const headings = [
        {key: 'url', itemType: 'url', text: 'URL'},
        {key: 'downloadTime', itemType: 'url', text: 'Time to download'},
      ];
      const details = Audit.makeTableDetails(headings, results);

      let debugString = null;
      if (results.length > 0) {
        if (results.length === 1) {
          debugString = `${URL.getURLDisplayName(results[0].url)} was discovered late but ` +
            `fetching it earlier may have improved how quickly the page was interactive ` +
            Util.formatMilliseconds(totalWastedMs);
        } else {
          debugString = `${results.length} scripts were discovered late but fetching it ` +
            `earlier may have improved how quickly the page was interactive ` +
            Util.formatMilliseconds(totalWastedMs);
        }
      }

      return {
        score: UnusedBytes.scoreForWastedMs(totalWastedMs),
        rawValue: totalWastedMs,
        displayValue: Util.formatMilliseconds(totalWastedMs),
        extendedInfo: {
          value: results,
        },
        details,
        debugString,
      };
    });
  }
}

module.exports = UsesRelPreloadAudit;
