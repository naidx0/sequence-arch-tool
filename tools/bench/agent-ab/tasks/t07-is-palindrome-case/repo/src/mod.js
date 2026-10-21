export function isPalindrome(s) {
  return s === s.split('').reverse().join('');
}
