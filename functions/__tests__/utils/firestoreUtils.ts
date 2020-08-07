import * as functionsTestInit from "firebase-functions-test";

/**
 * Creates a documentSnapshot using firebase-functions-test with
 * default data or provided input and path.
 * @param input
 * @param path
 */
export function createDocumentSnapshot(
  input: any = { input: "I like Paris. I like the Louvre." },
  path = "trips/id1"
) {
  const functionsTest = functionsTestInit();
  return functionsTest.firestore.makeDocumentSnapshot(input, path);
}
