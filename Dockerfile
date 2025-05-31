# Build stage for Go backend
FROM golang:1.24-alpine AS go-builder
WORKDIR /app

# Install build dependencies for CGO (needed for SQLite)
RUN apk add --no-cache gcc musl-dev sqlite-dev

# Copy Go module files and download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the Go application with CGO enabled for SQLite support
RUN CGO_ENABLED=1 GOOS=linux GOARCH=amd64 go build -o whatsapp-reader .

# Build stage for Node.js frontend
FROM node:20-alpine AS node-builder
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy frontend source code and vite config
COPY web/ ./web/
COPY vite.config.js ./

# Build the frontend (output will be in web/dist due to vite config root: 'web')
RUN npm run build

# Final stage
FROM alpine:latest
WORKDIR /app

# Install CA certificates and SQLite runtime for HTTPS requests and database
RUN apk --no-cache add ca-certificates tzdata sqlite

# Copy the built binary from the Go build stage
COPY --from=go-builder /app/whatsapp-reader /app/
# Copy the built frontend from the Node.js build stage (note: web/dist not just dist)
COPY --from=node-builder /app/web/dist /app/dist
# Copy any necessary config files
COPY config.json /app/

# Create directories for data persistence
RUN mkdir -p /app/session /app/ProfileImages /app/MediaFiles /app/MediaFiles/Images /app/MediaFiles/Videos /app/MediaFiles/Audio /app/MediaFiles/Documents

# Environment variables for database configuration
# These can be overridden at runtime
ENV DB_HOST=localhost
ENV DB_PORT=3306
ENV DB_USER=root
ENV DB_PASSWORD=
ENV DB_NAME=whatsapp_viewer

# Default port (can be overridden)
EXPOSE 8080
ENV PORT=8080

# Run the application
CMD ["/app/whatsapp-reader"] 