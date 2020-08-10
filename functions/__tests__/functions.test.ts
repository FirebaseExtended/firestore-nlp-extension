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

import * as functionsTestInit from "firebase-functions-test";
import mockedEnv from "mocked-env";
import { createDocumentSnapshot } from "./utils/firestoreUtils";
import {
  createMockDocSnapshotImplementation,
  mockFirestoreTransaction,
  mockFirestoreUpdate,
} from "./mocks/firestoreMocks";
import { mockConsoleLog, mockConsoleError } from "./mocks/consoleMocks";
import { Task } from "../src/models";

import {
  mockPerformEntityExtraction,
  mockPerformTextClassification,
  mockPerformSentimentAnalysis,
  NlpTaskHandlerMock,
} from "./mocks/nlpTaskHandlerMocks";

// setup mock for NlpTaskHandler
import { NlpTaskHandler } from "../src/nlpTaskHandler";
jest.mock("../src/nlpTaskHandler", () => {
  return {
    NlpTaskHandler: NlpTaskHandlerMock,
  };
});

// initialize SDK in offline mode
let functionsTest = functionsTestInit();

/**
 * Variables meant to match process environment variables set by
 * params in extension.yaml.
 */
const defaultEnvironment = {
  LOCATION: "us-central1",
  COLLECTION_PATH: "trips",
  INPUT_FIELD_NAME: "input",
  OUTPUT_FIELD_NAME: "inputNLP",
  TASKS: "ENTITY,SENTIMENT,CLASSIFICATION",
  ENTITY_TYPES: "LOCATION,EVENT",
  SAVE_COMMON_ENTITIES: "false",
};

/**
 * Clears all mocks that might be used for 'toHaveBeenCalled' type
 * of assertions.
 */
function clearMocks() {
  mockFirestoreUpdate.mockClear();
  mockConsoleLog.mockClear();
  mockConsoleError.mockClear();
  mockPerformSentimentAnalysis.mockClear();
  mockPerformTextClassification.mockClear();
  mockPerformEntityExtraction.mockClear();
}

describe("extension", () => {
  let mockEnv;

  beforeAll(() => {
    // setup mocked modules
    // clearing the console mocks only for them to be used by jest and replace actual console
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
  });

  test("function firestoreNLP is exported", () => {
    mockEnv = mockedEnv(defaultEnvironment);

    const exportedFunctions = jest.requireActual("../src");

    expect(exportedFunctions.firestoreNLP).toBeInstanceOf(Function);
  });

  describe("functions.firestoreNLP", () => {
    let wrappedFirestoreNLP;

    let admin;

    /**
     * Imports extension functions src and admin modules.
     * Usually needed after a "jest.resetModules()" since it clear admin import.
     */
    function resetRequiredModules() {
      wrappedFirestoreNLP = functionsTest.wrap(require("../src").firestoreNLP);
      admin = require("firebase-admin");
      admin.firestore().runTransaction = mockFirestoreTransaction();
    }

    beforeEach(() => {
      jest.resetModules();

      mockEnv = mockedEnv(defaultEnvironment);

      // setup function mock data and wrap
      functionsTest = functionsTestInit();

      resetRequiredModules();

      clearMocks();
    });

    describe("on document creation", () => {
      let beforeDocSnapshot;
      let afterDocSnapshot;
      let mockedBeforeDocSnapshot;
      let mockedAfterDocSnapshot;
      let change;

      beforeEach(() => {
        // setup the snapshot and mock snapshots for a CREATE scenario
        beforeDocSnapshot = createDocumentSnapshot();
        afterDocSnapshot = createDocumentSnapshot();
        mockedBeforeDocSnapshot = createMockDocSnapshotImplementation({
          documentSnapshot: beforeDocSnapshot,
          exists: false,
        });
        mockedAfterDocSnapshot = createMockDocSnapshotImplementation({
          documentSnapshot: afterDocSnapshot,
          exists: true,
        });
        change = functionsTest.makeChange(
          mockedBeforeDocSnapshot,
          mockedAfterDocSnapshot
        );
      });

      test(
        "does not try to update Firestore when the input field is not part " +
          "of a new document",
        async () => {
          // adjust default setup
          const newAfterDocSnapshot = createDocumentSnapshot({
            unrelated: "Unrelated field",
          });
          change = functionsTest.makeChange(
            mockedBeforeDocSnapshot,
            newAfterDocSnapshot
          );

          const resolution = await wrappedFirestoreNLP(change);

          expect(mockFirestoreUpdate).not.toHaveBeenCalled();

          // helps make sure the previous expectation happened by purpose
          // and not because function failed.
          expect(resolution).resolves;
        }
      );

      test(
        "logs the fact that no input was found when the input field is not " +
          "part of a new document",
        async () => {
          // adjust default setup
          const newAfterDocSnapshot = createDocumentSnapshot({
            unrelated: "Unrelated field",
          });
          change = functionsTest.makeChange(
            mockedBeforeDocSnapshot,
            newAfterDocSnapshot
          );

          await wrappedFirestoreNLP(change);

          expect(mockConsoleLog).toHaveBeenCalledWith(
            expect.stringMatching(/no processing/i)
          );
        }
      );

      test(
        "logs the completion of function when a document is created without " +
          "breaking errors during processing",
        async () => {
          await wrappedFirestoreNLP(change);

          expect(mockConsoleLog).toHaveBeenCalledWith(
            expect.stringMatching(/completed/i)
          );
        }
      );

      test("updates Firestore with empty object if all selected NLP tasks fail", async () => {
        const sentimentError = new Error("Sentiment Analysis Error");
        const classificationError = new Error("Classification Error");
        const entityError = new Error("Entity Extraction Error");
        mockPerformSentimentAnalysis.mockImplementationOnce(() =>
          Promise.resolve({ taskName: Task.SENTIMENT, error: sentimentError })
        );
        mockPerformTextClassification.mockImplementationOnce(() =>
          Promise.resolve({
            taskName: Task.CLASSIFICATION,
            error: classificationError,
          })
        );
        mockPerformEntityExtraction.mockImplementationOnce(() =>
          Promise.resolve({ taskName: Task.ENTITY, error: entityError })
        );

        await wrappedFirestoreNLP(change);

        expect(mockFirestoreUpdate).toHaveBeenLastCalledWith(
          change.after.ref,
          defaultEnvironment.OUTPUT_FIELD_NAME,
          {}
        );
      });

      test(
        "updates Firestore with the data of successful tasks even " +
          "when other tasks fail",
        async () => {
          // adjust the default env
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            TASKS: "SENTIMENT,ENTITY",
          });

          // adjust the behavior of the mocks
          const sentimentResponse = {
            taskName: Task.SENTIMENT,
            output: {
              score: 0.9,
              magnitude: 0.75,
            },
          };
          mockPerformSentimentAnalysis.mockImplementationOnce(() =>
            Promise.resolve(sentimentResponse)
          );
          const entityError = new Error("Entity Extraction Error");
          mockPerformEntityExtraction.mockImplementationOnce(() =>
            Promise.resolve({ taskName: Task.ENTITY, error: entityError })
          );

          resetRequiredModules(); // needed after jest.resetModules()

          await wrappedFirestoreNLP(change);

          const expectedNewData = {
            SENTIMENT: {
              score: 0.9,
              magnitude: 0.75,
            },
          };
          expect(mockFirestoreUpdate).toHaveBeenLastCalledWith(
            change.after.ref,
            defaultEnvironment.OUTPUT_FIELD_NAME,
            expectedNewData
          );
        }
      );

      test(
        "logs error if NlpTaskHandler returns an error response for " +
          "sentiment analysis",
        async () => {
          const sentimentError = new Error("Sentiment Analysis Error");
          mockPerformEntityExtraction.mockImplementationOnce(() =>
            Promise.resolve({ taskName: Task.SENTIMENT, error: sentimentError })
          );

          await wrappedFirestoreNLP(change);

          // double check to allow use of simple regex
          expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringMatching(/error/i),
            sentimentError
          );
          expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringMatching(/SENTIMENT/i),
            sentimentError
          );
        }
      );

      test(
        "logs error if NlpTaskHandler returns an error response for " +
          "text classification",
        async () => {
          const classificationError = new Error("Text Classification Error");
          mockPerformTextClassification.mockImplementationOnce(() =>
            Promise.resolve({
              taskName: Task.CLASSIFICATION,
              error: classificationError,
            })
          );

          await wrappedFirestoreNLP(change);

          // double check to allow use of simple regex
          expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringMatching(/error/i),
            classificationError
          );
          expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringMatching(/CLASSIFICATION/i),
            classificationError
          );
        }
      );

      test(
        "logs error if NlpTaskHandler returns an error response for " +
          "entity extraction",
        async () => {
          const entityError = new Error("Entity Extraction Error");
          mockPerformEntityExtraction.mockImplementationOnce(() =>
            Promise.resolve({ taskName: Task.ENTITY, error: entityError })
          );

          await wrappedFirestoreNLP(change);

          // double check to allow use of simple regex
          expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringMatching(/error/i),
            entityError
          );
          expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringMatching(/ENTITY/i),
            entityError
          );
        }
      );

      test(
        "logs the fact that an unknown task is found in the config " +
          "value TASKS",
        async () => {
          // adjust the default env
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            TASKS: "someTask",
          });
          // re-import modules because jest.resetModules
          resetRequiredModules();

          await wrappedFirestoreNLP(change);

          expect(mockConsoleLog).toHaveBeenCalledWith(
            expect.stringMatching(/someTask/)
          );
        }
      );

      test(
        "does not stop other tasks if an unknown task is found in the " +
          "config value TASKS",
        async () => {
          // adjust the default env
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            TASKS: "unknown,SENTIMENT",
          });
          // re-import modules because jest.resetModules
          resetRequiredModules();

          await wrappedFirestoreNLP(change);

          expect(mockFirestoreUpdate).toHaveBeenCalled();
        }
      );

      test("updates Firestore sentiment data when document is created", async () => {
        // adjust the default env to only perform sentiment analysis
        jest.resetModules();
        mockEnv = mockedEnv({
          ...defaultEnvironment,
          TASKS: "SENTIMENT",
        });

        // modify mock behavior for test
        const sentimentResponse = {
          taskName: Task.SENTIMENT,
          output: {
            score: 0.75,
            magnitude: 0.5,
          },
        };
        mockPerformSentimentAnalysis.mockImplementationOnce(() => {
          return Promise.resolve(sentimentResponse);
        });

        // re-import modules because jest.resetModules
        resetRequiredModules();

        await wrappedFirestoreNLP(change);

        const expectedNewData = {
          SENTIMENT: { score: 0.75, magnitude: 0.5 },
        };
        expect(mockFirestoreUpdate).toHaveBeenLastCalledWith(
          change.after.ref,
          defaultEnvironment.OUTPUT_FIELD_NAME,
          expectedNewData
        );
      });

      test("updates Firestore classification data when document is created", async () => {
        // adjust the default env to only perform sentiment analysis
        jest.resetModules();
        mockEnv = mockedEnv({
          ...defaultEnvironment,
          TASKS: "CLASSIFICATION",
        });

        // modify mock behavior for test
        const classificationResponse = {
          taskName: Task.CLASSIFICATION,
          output: ["/Internet & Telecom/Mobile & Wireless"],
        };
        mockPerformTextClassification.mockImplementationOnce(() => {
          return Promise.resolve(classificationResponse);
        });

        // re-import modules because jest.resetModules
        resetRequiredModules();

        await wrappedFirestoreNLP(change);

        const expectedNewData = {
          CLASSIFICATION: ["/Internet & Telecom/Mobile & Wireless"],
        };
        expect(mockFirestoreUpdate).toHaveBeenLastCalledWith(
          change.after.ref,
          defaultEnvironment.OUTPUT_FIELD_NAME,
          expectedNewData
        );
      });

      test("updates Firestore entity data when document is created", async () => {
        // adjust the default env
        jest.resetModules();
        mockEnv = mockedEnv({
          ...defaultEnvironment,
          TASKS: "ENTITY",
          ENTITY_TYPES: "LOCATION",
        });

        // modify mock behavior for test
        const entityResponse = {
          taskName: Task.ENTITY,
          output: {
            LOCATION: ["Paris"],
          },
        };
        mockPerformEntityExtraction.mockImplementationOnce(() => {
          return Promise.resolve(entityResponse);
        });

        // re-import modules because jest.resetModules
        resetRequiredModules();

        await wrappedFirestoreNLP(change);

        const expectedNewData = {
          ENTITY: {
            LOCATION: ["Paris"],
          },
        };
        expect(mockFirestoreUpdate).toHaveBeenLastCalledWith(
          change.after.ref,
          defaultEnvironment.OUTPUT_FIELD_NAME,
          expectedNewData
        );
      });

      test(
        "updates Firestore data of multiple successful NLP tasks when document " +
          "is created",
        async () => {
          // adjust the default env
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            TASKS: "SENTIMENT,ENTITY,CLASSIFICATION",
            ENTITY_TYPES: "LOCATION",
          });

          // modify mock behavior for test
          const sentimentResponse = {
            taskName: Task.SENTIMENT,
            output: {
              score: 0.9,
              magnitude: 0.75,
            },
          };
          mockPerformSentimentAnalysis.mockImplementationOnce(() => {
            return Promise.resolve(sentimentResponse);
          });
          const classificationResponse = {
            taskName: Task.CLASSIFICATION,
            output: ["/Internet & Telecom/Mobile & Wireless"],
          };
          mockPerformTextClassification.mockImplementationOnce(() => {
            return Promise.resolve(classificationResponse);
          });
          const entityResponse = {
            taskName: Task.ENTITY,
            output: {
              LOCATION: ["Paris"],
            },
          };
          mockPerformEntityExtraction.mockImplementationOnce(() => {
            return Promise.resolve(entityResponse);
          });

          // re-import modules because jest.resetModules
          resetRequiredModules();

          await wrappedFirestoreNLP(change);

          const expectedNewData = {
            SENTIMENT: {
              score: 0.9,
              magnitude: 0.75,
            },
            CLASSIFICATION: ["/Internet & Telecom/Mobile & Wireless"],
            ENTITY: {
              LOCATION: ["Paris"],
            },
          };
          expect(mockFirestoreUpdate).toHaveBeenLastCalledWith(
            change.after.ref,
            defaultEnvironment.OUTPUT_FIELD_NAME,
            expectedNewData
          );
        }
      );

      test(
        "updates Firestore with an empty 'CLASSIFICATION' array if the output " +
          "from NlpTaskHandler text classification is empty",
        async () => {
          // adjust the default env
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            TASKS: "CLASSIFICATION",
          });

          // modify mock behavior for test
          const classificationResponse = {
            taskName: Task.CLASSIFICATION,
            output: [],
          };
          mockPerformTextClassification.mockImplementationOnce(() => {
            return Promise.resolve(classificationResponse);
          });

          // re-import modules because jest.resetModules
          resetRequiredModules();

          await wrappedFirestoreNLP(change);

          expect(mockFirestoreUpdate).toHaveBeenLastCalledWith(
            change.after.ref,
            defaultEnvironment.OUTPUT_FIELD_NAME,
            { CLASSIFICATION: [] }
          );
        }
      );

      test(
        "updates Firestore with an empty 'ENTITY' object if the output from " +
          "NlpTaskHandler is empty",
        async () => {
          // adjust the default env
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            TASKS: "ENTITY",
          });

          // modify mock behavior for test
          const entityResponse = {
            taskName: Task.ENTITY,
            output: {},
          };
          mockPerformEntityExtraction.mockImplementationOnce(() => {
            return Promise.resolve(entityResponse);
          });

          // re-import modules because jest.resetModules
          resetRequiredModules();

          await wrappedFirestoreNLP(change);

          expect(mockFirestoreUpdate).toHaveBeenLastCalledWith(
            change.after.ref,
            defaultEnvironment.OUTPUT_FIELD_NAME,
            { ENTITY: {} }
          );
        }
      );
    });

    describe("on document update", () => {
      let beforeDocSnapshot;
      let afterDocSnapshot;
      let mockedBeforeDocSnapshot;
      let mockedAfterDocSnapshot;
      let change;

      beforeEach(() => {
        // setup the snapshot and mock snapshots for a UPDATE scenario
        beforeDocSnapshot = createDocumentSnapshot({ input: "Before" });
        afterDocSnapshot = createDocumentSnapshot({ input: "After" });
        mockedBeforeDocSnapshot = createMockDocSnapshotImplementation({
          documentSnapshot: beforeDocSnapshot,
          exists: true,
        });
        mockedAfterDocSnapshot = createMockDocSnapshotImplementation({
          documentSnapshot: afterDocSnapshot,
          exists: true,
        });
        change = functionsTest.makeChange(
          mockedBeforeDocSnapshot,
          mockedAfterDocSnapshot
        );
      });

      test(
        "does not perform NLP operations on document update with input " +
          "field unchanged",
        async () => {
          // adjust default setup for update scenario
          const newMockBeforeDocSnap = createMockDocSnapshotImplementation({
            documentSnapshot: createDocumentSnapshot({ input: "Test" }),
            exists: true,
          });
          const newMockAfterDocSnap = createMockDocSnapshotImplementation({
            documentSnapshot: createDocumentSnapshot({ input: "Test" }),
            exists: true,
          });
          change = functionsTest.makeChange(
            newMockBeforeDocSnap,
            newMockAfterDocSnap
          );

          const resolution = await wrappedFirestoreNLP(change);

          expect(mockPerformSentimentAnalysis).not.toHaveBeenCalled();
          expect(mockPerformTextClassification).not.toHaveBeenCalled();
          expect(mockPerformEntityExtraction).not.toHaveBeenCalled();

          // helps make sure the previous expectation happened by purpose
          // and not because function failed.
          expect(resolution).resolves;
        }
      );

      test(
        "does not perform Firestore operations on document update with input " +
          "field unchanged",
        async () => {
          // adjust default setup for update scenario
          const newMockBeforeDocSnap = createMockDocSnapshotImplementation({
            documentSnapshot: createDocumentSnapshot({ input: "Test" }),
            exists: true,
          });
          const newMockAfterDocSnap = createMockDocSnapshotImplementation({
            documentSnapshot: createDocumentSnapshot({ input: "Test" }),
            exists: true,
          });
          change = functionsTest.makeChange(
            newMockBeforeDocSnap,
            newMockAfterDocSnap
          );

          const resolution = await wrappedFirestoreNLP(change);

          expect(mockFirestoreUpdate).not.toHaveBeenCalled();

          // helps make sure the previous expectation happened by purpose
          // and not because function failed.
          expect(resolution).resolves;
        }
      );

      test(
        "logs no processing needed on document update with input " +
          "field unchanged",
        async () => {
          // adjust default setup for update scenario
          const newMockBeforeDocSnap = createMockDocSnapshotImplementation({
            documentSnapshot: createDocumentSnapshot({ input: "Test" }),
            exists: true,
          });
          const newMockAfterDocSnap = createMockDocSnapshotImplementation({
            documentSnapshot: createDocumentSnapshot({ input: "Test" }),
            exists: true,
          });
          change = functionsTest.makeChange(
            newMockBeforeDocSnap,
            newMockAfterDocSnap
          );

          await wrappedFirestoreNLP(change);

          expect(mockConsoleLog).toHaveBeenCalledWith(
            expect.stringMatching(/document.*updated/i)
          );
          expect(mockConsoleLog).toHaveBeenCalledWith(
            expect.stringMatching(/no processing/i)
          );
        }
      );

      test(
        "updates Firestore output field when document is updated with new " +
          "data in input field",
        async () => {
          // adjust the default env to only perform sentiment analysis
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            TASKS: "SENTIMENT",
          });

          // modify mock behavior for test
          const sentimentResponse = {
            taskName: Task.SENTIMENT,
            output: {
              score: 0.75,
              magnitude: 0.5,
            },
          };
          mockPerformSentimentAnalysis.mockImplementationOnce(() => {
            return Promise.resolve(sentimentResponse);
          });

          // re-import modules because jest.resetModules
          resetRequiredModules();

          await wrappedFirestoreNLP(change);

          const expectedNewData = {
            SENTIMENT: { score: 0.75, magnitude: 0.5 },
          };
          expect(mockFirestoreUpdate).toHaveBeenLastCalledWith(
            change.after.ref,
            defaultEnvironment.OUTPUT_FIELD_NAME,
            expectedNewData
          );
        }
      );

      test(
        "logs an update occured with new input field data when document is " +
          "updated with new data in input field",
        async () => {
          await wrappedFirestoreNLP(change);

          expect(mockConsoleLog).toHaveBeenCalledWith(
            expect.stringMatching(/document.*updated/i)
          );
          expect(mockConsoleLog).toHaveBeenCalledWith(
            expect.stringMatching(/input.*changed/i)
          );
        }
      );

      test(
        "deletes output field when document is updated with deletion of " +
          "input field",
        async () => {
          // adjust default setup for update scenario
          const newMockBeforeDocSnap = createMockDocSnapshotImplementation({
            documentSnapshot: createDocumentSnapshot({ input: "Test" }),
            exists: true,
          });
          const newMockAfterDocSnap = createMockDocSnapshotImplementation({
            documentSnapshot: createDocumentSnapshot({
              notInput: "Not input field",
            }),
            exists: true,
          });
          change = functionsTest.makeChange(
            newMockBeforeDocSnap,
            newMockAfterDocSnap
          );

          await wrappedFirestoreNLP(change);

          expect(mockFirestoreUpdate).toHaveBeenLastCalledWith(
            change.after.ref,
            defaultEnvironment.OUTPUT_FIELD_NAME,
            admin.firestore.FieldValue.delete()
          );
        }
      );

      test(
        "logs an update occured with deletion of input field when document " +
          "is updated with deletion of input field",
        async () => {
          // adjust default setup for update scenario
          const newMockBeforeDocSnap = createMockDocSnapshotImplementation({
            documentSnapshot: createDocumentSnapshot({ input: "Test" }),
            exists: true,
          });
          const newMockAfterDocSnap = createMockDocSnapshotImplementation({
            documentSnapshot: createDocumentSnapshot({
              notInput: "Not input field",
            }),
            exists: true,
          });
          change = functionsTest.makeChange(
            newMockBeforeDocSnap,
            newMockAfterDocSnap
          );

          await wrappedFirestoreNLP(change);

          expect(mockConsoleLog).toHaveBeenCalledWith(
            expect.stringMatching(/document.*updated/i)
          );
          expect(mockConsoleLog).toHaveBeenCalledWith(
            expect.stringMatching(/input.*deleted/i)
          );
        }
      );

      test(
        "logs an update occured but the input field never existed when " +
          "document is updated and input filed is missing before and after update",
        async () => {
          // adjust default setup for update scenario
          const newMockBeforeDocSnap = createMockDocSnapshotImplementation({
            documentSnapshot: createDocumentSnapshot({ notInput: "Test" }),
            exists: true,
          });
          const newMockAfterDocSnap = createMockDocSnapshotImplementation({
            documentSnapshot: createDocumentSnapshot({
              notInput: "Not input field",
            }),
            exists: true,
          });
          change = functionsTest.makeChange(
            newMockBeforeDocSnap,
            newMockAfterDocSnap
          );

          await wrappedFirestoreNLP(change);

          expect(mockConsoleLog).toHaveBeenCalledWith(
            expect.stringMatching(/document.*updated/i)
          );
          expect(mockConsoleLog).toHaveBeenCalledWith(
            expect.stringMatching(/no input.*exists/i)
          );
          expect(mockConsoleLog).toHaveBeenCalledWith(
            expect.stringMatching(/no.*processing/i)
          );
        }
      );
    });

    describe("on document delete", () => {
      let beforeDocSnapshot;
      let afterDocSnapshot;
      let mockedBeforeDocSnapshot;
      let mockedAfterDocSnapshot;
      let change;

      beforeEach(() => {
        // setup the snapshot and mock snapshots for a DELETE scenario
        beforeDocSnapshot = createDocumentSnapshot();
        afterDocSnapshot = createDocumentSnapshot();
        mockedBeforeDocSnapshot = createMockDocSnapshotImplementation({
          documentSnapshot: beforeDocSnapshot,
          exists: true,
        });
        mockedAfterDocSnapshot = createMockDocSnapshotImplementation({
          documentSnapshot: afterDocSnapshot,
          exists: false,
        });
        change = functionsTest.makeChange(
          mockedBeforeDocSnapshot,
          mockedAfterDocSnapshot
        );
      });

      test("logs that the document was deleted on document delete", async () => {
        await wrappedFirestoreNLP(change);

        expect(mockConsoleLog).toHaveBeenCalledWith(
          expect.stringMatching(/document.*deleted/i)
        );
      });

      test("does not perform NLP operations on document delete", async () => {
        const resolution = await wrappedFirestoreNLP(change);

        expect(mockPerformSentimentAnalysis).not.toHaveBeenCalled();
        expect(mockPerformTextClassification).not.toHaveBeenCalled();
        expect(mockPerformEntityExtraction).not.toHaveBeenCalled();

        // helps make sure the previous expectation happened by purpose
        // and not because function failed.
        expect(resolution).resolves;
      });

      test("does not perform Firestore operations on document delete", async () => {
        const resolution = await wrappedFirestoreNLP(change);

        expect(mockFirestoreUpdate).not.toHaveBeenCalled();

        // helps make sure the previous expectation happened by purpose
        // and not because function failed.
        expect(resolution).resolves;
      });
    });

    describe("on any operation", () => {
      let change;

      beforeEach(() => {
        // setup as a CREATE scenario as a default scenario since this suite
        // should not care
        const beforeDocSnapshot = createDocumentSnapshot();
        const afterDocSnapshot = createDocumentSnapshot();
        const mockedBeforeDocSnapshot = createMockDocSnapshotImplementation({
          documentSnapshot: beforeDocSnapshot,
          exists: false,
        });
        const mockedAfterDocSnapshot = createMockDocSnapshotImplementation({
          documentSnapshot: afterDocSnapshot,
          exists: true,
        });
        change = functionsTest.makeChange(
          mockedBeforeDocSnapshot,
          mockedAfterDocSnapshot
        );
      });

      test("calls the constructor of NlpTaskHandler with the right parameters", async () => {
        // adjust the default env
        jest.resetModules();
        mockEnv = mockedEnv({
          ...defaultEnvironment,
          ENTITY_TYPES: "LOCATION,PERSON",
          SAVE_COMMON_ENTITIES: "true",
          SAVE_BIG_QUERY: "false", // only used here to make sure there isn't a mix up between booleans
        });

        resetRequiredModules(); // needed after jest.resetModules()

        await wrappedFirestoreNLP(change);

        expect(NlpTaskHandlerMock).toHaveBeenLastCalledWith({
          entityTypesToSave: ["LOCATION", "PERSON"],
          saveCommonEntities: true,
        });
      });

      test(
        "does not perform NLP operations when input field name is the " +
          "same as output field name",
        async () => {
          // adjust the default env
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            INPUT_FIELD_NAME: "input",
            OUTPUT_FIELD_NAME: "input",
          });

          // re-import modules because jest.resetModules
          resetRequiredModules();

          const resolution = await wrappedFirestoreNLP(change);

          expect(mockPerformSentimentAnalysis).not.toHaveBeenCalled();
          expect(mockPerformTextClassification).not.toHaveBeenCalled();
          expect(mockPerformEntityExtraction).not.toHaveBeenCalled();

          // helps make sure the previous expectation happened by purpose
          // and not because function failed.
          expect(resolution).resolves;
        }
      );

      test(
        "does not perform Firestore operations when input field name is the " +
          "same as output field name",
        async () => {
          // adjust the default env
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            INPUT_FIELD_NAME: "input",
            OUTPUT_FIELD_NAME: "input",
          });

          // re-import modules because jest.resetModules
          resetRequiredModules();

          const resolution = await wrappedFirestoreNLP(change);

          expect(mockFirestoreUpdate).not.toHaveBeenCalled();

          // helps make sure the previous expectation happened by purpose
          // and not because function failed.
          expect(resolution).resolves;
        }
      );

      test(
        "logs that input field name and output field name must be different " +
          "when input field name is the same as output field name",
        async () => {
          // adjust the default env
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            INPUT_FIELD_NAME: "input",
            OUTPUT_FIELD_NAME: "input",
          });

          // re-import modules because jest.resetModules
          resetRequiredModules();

          await wrappedFirestoreNLP(change);

          expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringMatching(/input/i)
          );
          expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringMatching(/output/i)
          );
          expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringMatching(/different/i)
          );
        }
      );

      test(
        "does not perform NLP operations when input field name is a subfield " +
          "of output field",
        async () => {
          // adjust the default env
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            INPUT_FIELD_NAME: "input.nlp",
            OUTPUT_FIELD_NAME: "input",
          });

          // re-import modules because jest.resetModules
          resetRequiredModules();

          const resolution = await wrappedFirestoreNLP(change);

          expect(mockPerformSentimentAnalysis).not.toHaveBeenCalled();
          expect(mockPerformTextClassification).not.toHaveBeenCalled();
          expect(mockPerformEntityExtraction).not.toHaveBeenCalled();

          // helps make sure the previous expectation happened by purpose
          // and not because function failed.
          expect(resolution).resolves;
        }
      );

      test(
        "does not perform Firestore operations when input field name is a " +
          "subfield of output field",
        async () => {
          // adjust the default env
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            INPUT_FIELD_NAME: "input.nlp",
            OUTPUT_FIELD_NAME: "input",
          });

          // re-import modules because jest.resetModules
          resetRequiredModules();

          const resolution = await wrappedFirestoreNLP(change);

          expect(mockFirestoreUpdate).not.toHaveBeenCalled();

          // helps make sure the previous expectation happened by purpose
          // and not because function failed.
          expect(resolution).resolves;
        }
      );

      test(
        "logs that input field name and output field name must be different " +
          "when input field name is a subfield of output field",
        async () => {
          // adjust the default env
          jest.resetModules();
          mockEnv = mockedEnv({
            ...defaultEnvironment,
            INPUT_FIELD_NAME: "input.nlp",
            OUTPUT_FIELD_NAME: "input",
          });

          // re-import modules because jest.resetModules
          resetRequiredModules();

          await wrappedFirestoreNLP(change);

          expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringMatching(/input/i)
          );
          expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringMatching(/output/i)
          );
          expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringMatching(/subfield/i)
          );
        }
      );
    });
  });
});
