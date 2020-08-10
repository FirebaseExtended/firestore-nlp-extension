/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as utils from "../src/utilities";
import * as functionsTestInit from "firebase-functions-test";
import { createDocumentSnapshot } from "./utils/firestoreUtils";
import { createMockDocSnapshotImplementation } from "./mocks/firestoreMocks";

const functionsTest = functionsTestInit();

describe("utilities", () => {
  let beforeDocSnapshot;
  let afterDocSnapshot;

  beforeEach(() => {
    beforeDocSnapshot = createDocumentSnapshot();
    afterDocSnapshot = createDocumentSnapshot();
  });

  test("getChangeType returns CREATE when change object comes in for new doc", () => {
    const mockedBeforeDocSnapshot = createMockDocSnapshotImplementation({
      documentSnapshot: beforeDocSnapshot,
      exists: false,
    });
    const mockedAfterDocSnapshot = createMockDocSnapshotImplementation({
      documentSnapshot: afterDocSnapshot,
      exists: true,
    });
    const change = functionsTest.makeChange(
      mockedBeforeDocSnapshot,
      mockedAfterDocSnapshot
    );

    const changeType = utils.getChangeType(change);

    expect(changeType).toBe(utils.ChangeType.CREATE);
  });

  test("getChangeType returns DELETE when change object comes in for deleted doc", () => {
    const mockedBeforeDocSnapshot = createMockDocSnapshotImplementation({
      documentSnapshot: beforeDocSnapshot,
      exists: true,
    });
    const mockedAfterDocSnapshot = createMockDocSnapshotImplementation({
      documentSnapshot: afterDocSnapshot,
      exists: false,
    });
    const change = functionsTest.makeChange(
      mockedBeforeDocSnapshot,
      mockedAfterDocSnapshot
    );

    const changeType = utils.getChangeType(change);

    expect(changeType).toBe(utils.ChangeType.DELETE);
  });

  test("getChangeType returns UPDATE when change object comes in for updated doc", () => {
    const mockedBeforeDocSnapshot = createMockDocSnapshotImplementation({
      documentSnapshot: beforeDocSnapshot,
      exists: true,
    });
    const mockedAfterDocSnapshot = createMockDocSnapshotImplementation({
      documentSnapshot: afterDocSnapshot,
      exists: true,
    });
    const change = functionsTest.makeChange(
      mockedBeforeDocSnapshot,
      mockedAfterDocSnapshot
    );

    const changeType = utils.getChangeType(change);

    expect(changeType).toBe(utils.ChangeType.UPDATE);
  });
});
