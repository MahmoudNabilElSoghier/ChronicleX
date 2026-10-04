## Multipart request ordering gotcha

NestJS pipeline: Middleware → Guards → Interceptors → Pipes → Handler.
FileInterceptor (multer) is an Interceptor. That means:

- Guards run BEFORE multipart bodies are parsed.
- req.body is {} in guards for multipart requests.

RULE: Never use scopeHint with source: 'body' on multipart endpoints.
Use @RequirePermission without scopeHint at the guard layer, and enforce
project-scoped access in the service layer after parsing.
