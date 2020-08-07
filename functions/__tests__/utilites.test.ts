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
