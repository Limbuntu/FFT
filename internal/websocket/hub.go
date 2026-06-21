package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	gws "github.com/gorilla/websocket"
)

type Hub struct {
	mu       sync.Mutex
	clients  map[*gws.Conn]struct{}
	upgrader gws.Upgrader
}

func NewHub() *Hub {
	return &Hub{
		clients: map[*gws.Conn]struct{}{},
		upgrader: gws.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func (h *Hub) Handle(c *gin.Context) {
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("websocket upgrade failed: %v", err)
		return
	}

	h.mu.Lock()
	h.clients[conn] = struct{}{}
	count := len(h.clients)
	h.mu.Unlock()
	log.Printf("WebSocket client connected (%d total)", count)

	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, conn)
			count := len(h.clients)
			h.mu.Unlock()
			_ = conn.Close()
			log.Printf("WebSocket client disconnected (%d total)", count)
		}()

		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

func (h *Hub) Broadcast(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("websocket marshal failed: %v", err)
		return
	}

	h.mu.Lock()
	clients := make([]*gws.Conn, 0, len(h.clients))
	for conn := range h.clients {
		clients = append(clients, conn)
	}
	h.mu.Unlock()

	for _, conn := range clients {
		if err := conn.WriteMessage(gws.TextMessage, data); err != nil {
			h.mu.Lock()
			delete(h.clients, conn)
			h.mu.Unlock()
			_ = conn.Close()
		}
	}
}
