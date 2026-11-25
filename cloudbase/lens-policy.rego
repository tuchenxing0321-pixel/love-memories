package authz.user

# 只放行网页现在需要的 dateApi 和 lensApi。具体读写权限仍由
# 各函数内的会话、共享密钥、所有权与限频校验决定。
allowed_function_path if {
  startswith(input.request.path, "/v1/functions/dateApi")
}

allowed_function_path if {
  startswith(input.request.path, "/v1/functions/lensApi")
}

allow if {
  input.cloudbase.resource_type == "functions"
  input.subject.auth_type in {"anonymous", "anon"}
  allowed_function_path
}
