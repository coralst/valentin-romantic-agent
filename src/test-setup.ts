import '@testing-library/jest-dom';

// jsdom doesn't implement scrollIntoView.
// Guarded because this setup file also runs for suites that opt into the node
// environment (the CDK synth tests under infra/), where there is no DOM.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}
