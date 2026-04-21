import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Building2, ArrowLeft } from "lucide-react";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <Building2 className="h-16 w-16 text-primary/30 mb-6" />
      <h1 className="text-6xl font-bold text-primary mb-2">404</h1>
      <p className="text-lg text-muted-foreground mb-1">Page not found</p>
      <p className="text-sm text-muted-foreground/70 mb-8 text-center max-w-md">
        The page you are looking for does not exist or has been moved.
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Go Back
        </Button>
        <Button onClick={() => navigate("/dashboard")}>
          Dashboard
        </Button>
      </div>
    </div>
  );
}
