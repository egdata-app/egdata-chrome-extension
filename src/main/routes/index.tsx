import { Button } from "@/components/ui/button";
import { messagingClient } from "@/lib/clients/messaging";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="max-w-2xl w-full p-8 space-y-6">
        <h1 className="text-4xl font-bold text-foreground text-center">
          egdata.app
        </h1>
        <p className="text-lg text-foreground/80 text-center">
          Example extension for egdata.app
        </p>
        <div className="flex justify-center">
          <Button
            className="px-6 py-2"
            onClick={async () => {
              const response = await messagingClient.getEpicToken();
              console.log(response);
            }}
          >
            Click me
          </Button>
        </div>
      </div>
    </div>
  );
}
