public class Main {
    public static void main(String[] args) throws Exception {
        String mode = System.getenv("M07_MODE");
        if (mode == null) mode = "sleep";
        switch (mode) {
            case "sleep":
                System.err.println("client starting");
                Thread.sleep(Long.parseLong(System.getenv().getOrDefault("M07_SLEEP_MS", "3000")));
                System.exit(0);
                break;
            case "crash":
                new IllegalStateException("plugin manager failed").printStackTrace();
                System.exit(1);
                break;
            case "secrets":
                StringBuilder all = new StringBuilder();
                for (String a : args) all.append(a).append(' ');
                System.err.println("args: " + all);
                System.err.println("proxy socks5://bob:hunter2@10.0.0.5:1080 password=hunter2 JX_SESSION_ID=abc123 mail bob@example.com");
                System.err.println("home " + System.getProperty("user.home") + "/.microbot");
                System.err.println("logged in as Zezima the Great");
                System.exit(3);
                break;
            case "spam":
                for (int i = 0; i < 500; i++) System.err.println("noise line " + i);
                System.exit(2);
                break;
            default:
                System.exit(9);
        }
    }
}
