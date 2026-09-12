export const POST_SIGNUP_FLAG = 'ash_post_signup';

export function markPostSignup() {
  try {
    sessionStorage.setItem(POST_SIGNUP_FLAG, '1');
  } catch {
    /* private mode */
  }
}

export function isPostSignup() {
  try {
    return sessionStorage.getItem(POST_SIGNUP_FLAG) === '1';
  } catch {
    return false;
  }
}

export function clearPostSignup() {
  try {
    sessionStorage.removeItem(POST_SIGNUP_FLAG);
  } catch {
    /* private mode */
  }
}
