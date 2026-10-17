export function average(nums) {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
