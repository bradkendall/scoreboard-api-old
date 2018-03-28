# scoreboard-api
Backend for the running kitty game on the homepage.

# Main tasks

Tasks                         | Description
------------------------------|---------------------------------------------------------------------------------------
yarn start                    | Start server on `http://localhost:3000/`

# Reverse Proxy for SSL
To run on production, the server will need to be proxied to provide SSL (including socket.io).  

A basic example:

```
upstream upstream-nodejs {
        server  127.0.0.1:3000;
}
server {
        listen                  80;
        server_name             scoreboard-api.kittycash.com;
        rewrite                 ^(.*)   https://$host$1 permanent;
}
server {
        listen                  443 ssl;
        ssl                     on;
        server_name             scoreboard-api.kittycash.com;
        access_log              /var/log/nginx/access-ssl.log;
        error_log               /var/log/nginx/error-ssl.log;
        ssl_certificate         /etc/nginx/ssl/wasmycertificate.crt;
        ssl_certificate_key     /etc/nginx/ssl/mycertificate.key;
        ssl_protocols           SSLv3 TLSv1 TLSv1.1 TLSv1.2;
        ssl_ciphers             RC4:HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;
        keepalive_timeout       60;
        ssl_session_cache       shared:SSL:10m;
        ssl_session_timeout     10m;
        large_client_header_buffers 8 32k;
        location /scoreboard/ {
                proxy_pass              http://upstream-nodejs;
                proxy_next_upstream     error timeout invalid_header http_500 http_502 http_503 http_504;
                proxy_redirect          off;
                proxy_buffering         off;
                proxy_set_header        Host                    $host;
                proxy_set_header        X-Real-IP               $remote_addr;
                proxy_set_header        X-Forwarded-For         $proxy_add_x_forwarded_for;
                proxy_set_header        X-Forwarded-Proto       $scheme;
                add_header              Front-End-Https         on;
        }
        location /socket.io/ {
                proxy_pass              http://upstream-nodejs;
                proxy_redirect off;
                proxy_http_version      1.1;
                proxy_set_header        Upgrade                 $http_upgrade;
                proxy_set_header        Connection              "upgrade";
                proxy_set_header        Host                    $host;
                proxy_set_header        X-Real-IP               $remote_addr;
                proxy_set_header        X-Forwarded-For         $proxy_add_x_forwarded_for;
        }
}
```