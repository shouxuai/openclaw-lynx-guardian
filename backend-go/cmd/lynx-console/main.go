package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/openclaw/lynx-guardian/backend-go/internal/app"
	"github.com/openclaw/lynx-guardian/backend-go/internal/config"
)

func main() {
	cfg, err := config.Resolve()
	if err != nil {
		log.Fatalf("resolve config: %v", err)
	}

	handler, closer, err := app.Build(cfg)
	if err != nil {
		log.Fatalf("build app: %v", err)
	}
	defer closer()

	server := &http.Server{
		Addr:              cfg.ListenHost + ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("lynx-console listening on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
