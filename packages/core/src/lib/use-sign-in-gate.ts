export const useSignInGate = () => () => {
  window.dispatchEvent(new Event("open-provider-settings"));
};
