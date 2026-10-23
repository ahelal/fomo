/// <reference types="wink-nlp" />

// wink-nlp declares extensionless utility modules; Node ESM requires the .js paths.
declare module 'wink-nlp/utilities/bm25-vectorizer.js' {
  import vectorizer from 'wink-nlp/utilities/bm25-vectorizer';
  export default vectorizer;
}

declare module 'wink-nlp/utilities/similarity.js' {
  import similarity from 'wink-nlp/utilities/similarity';
  export default similarity;
}
