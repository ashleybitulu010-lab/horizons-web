/** Remove the instant HTML boot splash once React startup UI is ready. */
export function dismissBootSplash() {
  if (typeof document === 'undefined') return;
  document.getElementById('ash-boot')?.remove();
  document.documentElement.style.backgroundColor = '';
  document.body.style.backgroundColor = '';
}
