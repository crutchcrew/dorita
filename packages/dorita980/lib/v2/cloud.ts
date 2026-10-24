export default function cloudV2(user: string, password: string): never {
  if (!user) throw new Error('robotID is required.');
  if (!password) throw new Error('password is required.');

  throw new Error('Not implemented.');
}
